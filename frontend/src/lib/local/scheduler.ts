/**
 * Cienka warstwa miedzy rekordami lokalnymi a biblioteka ts-fsrs (FSRS-6).
 *
 * Jedyne miejsce, ktore wie, jak dziala FSRS - odpowiednik
 * backend/app/core/scheduler.py. Reszta kodu operuje na FsrsSnapshot
 * (daty jako ISO string) i nie importuje ts-fsrs bezposrednio.
 */

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating as FsrsRating,
  State,
  type Card,
  type FSRS,
  type Grade,
} from "ts-fsrs";

import type { Rating } from "@/lib/types";

import { humanizeInterval } from "./time";
import type { FsrsSnapshot, SettingsRecord } from "./types";

/**
 * Fuzzing celowo WLACZONY - odwrotnie niz w backendzie.
 *
 * Tam determinizm byl warunkiem synchronizacji (stan karty odtwarzany z logu
 * na wielu urzadzeniach, ADR 0002). Wersja lokalna zyje na jednym urzadzeniu
 * (ADR 0006), wiec ta przeslanka znikla, a rozrzucanie interwalow zapobiega
 * zlepianiu sie powtorek w jeden dzien.
 *
 * Podglad na przyciskach ocen pozostaje wiarygodny: fuzz w ts-fsrs jest siany
 * stanem karty, wiec podglad i faktyczna ocena licza to samo. Pilnuje tego
 * test "podglad nie klamie" - gdyby kiedys zaczal padac po aktualizacji
 * biblioteki, podglad trzeba liczyc inaczej, a nie wylaczac test.
 */
export const ENABLE_FUZZING = true;

type SchedulerSettings = Pick<SettingsRecord, "desiredRetention" | "fsrsParameters">;

/**
 * Buduje planiste.
 *
 * `maxIntervalDays` przycina najdluzszy mozliwy odstep. Ma znaczenie przy
 * terminie egzaminu: bez niego dwa razy "Latwe" na swiezej karcie daje
 * termin za ponad dwa miesiace, czyli PO egzaminie - material zniknalby
 * z kolejki dokladnie wtedy, gdy trzeba go utrwalac. Z przycieciem karta
 * wraca najpozniej kilka dni przed terminem.
 */
export function makeScheduler(
  settings: SchedulerSettings,
  options?: { enableFuzz?: boolean; maxIntervalDays?: number },
): FSRS {
  const maks = options?.maxIntervalDays;
  return fsrs(
    generatorParameters({
      request_retention: settings.desiredRetention,
      enable_fuzz: options?.enableFuzz ?? ENABLE_FUZZING,
      ...(maks && maks > 0 ? { maximum_interval: Math.max(1, Math.floor(maks)) } : {}),
      ...(settings.fsrsParameters ? { w: settings.fsrsParameters } : {}),
    }),
  );
}

/**
 * Ile dni przed egzaminem karta musi wrocic. Trzy dni zapasu: powtorka
 * w przeddzien jest juz tylko uspokajaniem sumienia.
 */
export function maxIntervalForExam(
  examDate: string | null | undefined,
  now: Date,
): number | undefined {
  if (!examDate) return undefined;
  const cel = new Date(`${examDate}T12:00:00`).getTime();
  const dni = Math.floor((cel - now.getTime()) / (24 * 3600_000)) - 3;
  return dni > 0 ? dni : undefined;
}

export function schedulerVersion(settings: SchedulerSettings): string {
  return `ts-fsrs/${settings.fsrsParameters ? "custom" : "default"}`;
}

// --- konwersja rekord <-> karta biblioteki ---------------------------------

export function toSnapshot(card: Card): FsrsSnapshot {
  const snap: FsrsSnapshot = {
    ...card,
    due: card.due.toISOString(),
    state: card.state as number,
    last_review: card.last_review ? card.last_review.toISOString() : undefined,
  };
  if (snap.last_review === undefined) delete snap.last_review;
  return snap;
}

export function fromSnapshot(snap: FsrsSnapshot): Card {
  return {
    ...snap,
    due: new Date(snap.due),
    state: snap.state as State,
    last_review: snap.last_review ? new Date(snap.last_review) : undefined,
  };
}

/** Swiezo utworzona karta - nigdy nie widziana (state=New). */
export function newCardSnapshot(at: Date): FsrsSnapshot {
  return toSnapshot(createEmptyCard(at));
}

export function isNew(snap: FsrsSnapshot): boolean {
  return snap.state === State.New;
}

// --- operacje --------------------------------------------------------------

/** Ocenia karte i zwraca nowy stan. Nie zapisuje niczego - to robi repo. */
export function applyReview(
  scheduler: FSRS,
  snap: FsrsSnapshot,
  rating: Rating,
  now: Date,
): FsrsSnapshot {
  const { card } = scheduler.next(fromSnapshot(snap), now, rating as Grade);
  return toSnapshot(card);
}

const GRADES: Grade[] = [FsrsRating.Again, FsrsRating.Hard, FsrsRating.Good, FsrsRating.Easy];

/**
 * Dla kazdej z 4 ocen liczy, kiedy karta wrocilaby do kolejki - etykiety na
 * przyciski ekranu nauki. Nic nie zapisuje.
 */
export function previewIntervals(
  scheduler: FSRS,
  snap: FsrsSnapshot,
  now: Date,
): Record<Rating, string> {
  const out = {} as Record<Rating, string>;
  for (const grade of GRADES) {
    const { card } = scheduler.next(fromSnapshot(snap), now, grade);
    out[grade as Rating] = humanizeInterval(card.due.getTime() - now.getTime());
  }
  return out;
}

/** Szacowane prawdopodobienstwo poprawnej odpowiedzi w danym momencie. */
export function retrievability(scheduler: FSRS, snap: FsrsSnapshot, now: Date): number {
  return scheduler.get_retrievability(fromSnapshot(snap), now, false);
}
