/**
 * Testy warstwy planowania (ts-fsrs) - port kluczowych wlasnosci z
 * backend/tests/test_scheduler.py, z odwrocona rola fuzzingu: tu ma byc
 * WLACZONY, a podglad ma mimo to mowic prawde.
 */

import { describe, expect, it } from "vitest";
import type { FSRS } from "ts-fsrs";

import type { Rating } from "@/lib/types";

import {
  ENABLE_FUZZING,
  applyReview,
  fromSnapshot,
  isNew,
  makeScheduler,
  newCardSnapshot,
  previewIntervals,
  retrievability,
  toSnapshot,
} from "./scheduler";
import { dayStart, humanizeInterval } from "./time";
import type { FsrsSnapshot } from "./types";

const NOW = new Date("2026-01-15T12:00:00");
const SETTINGS = { desiredRetention: 0.9, fsrsParameters: null };

/** Ocenia "Dobre" w kolejnych terminach, az karta wejdzie w stan Review (2). */
function driveToReview(
  scheduler: FSRS,
  at: Date,
): { snap: FsrsSnapshot; at: Date } {
  let snap = newCardSnapshot(at);
  let moment = at;
  for (let i = 0; i < 10; i += 1) {
    if (snap.state === 2) return { snap, at: moment };
    snap = applyReview(scheduler, snap, 3, moment);
    moment = new Date(snap.due);
  }
  throw new Error("karta nie osiagnela stanu Review w 10 powtorkach");
}

// --- fuzzing i podglad -----------------------------------------------------

it("fuzzing pozostaje wlaczony", () => {
  // Odwrotnie niz w backendzie - i rownie celowo. Przeslanka wylaczenia
  // (determinizm dla synchronizacji) znikla wraz z ADR 0006. Przed zmiana
  // tej wartosci przeczytaj tamten dokument.
  expect(ENABLE_FUZZING).toBe(true);
});

describe("podglad nie klamie mimo fuzzingu", () => {
  // Fuzz w ts-fsrs jest siany stanem karty, wiec podglad i faktyczna ocena
  // w tym samym momencie licza to samo. Gdyby ten test zaczal padac po
  // aktualizacji biblioteki, naprawic trzeba podglad, nie test.
  for (const mature of [false, true]) {
    for (const rating of [1, 2, 3, 4] as Rating[]) {
      it(`ocena ${rating}, ${mature ? "karta utrwalona" : "karta swieza"}`, () => {
        const scheduler = makeScheduler(SETTINGS);
        const { snap, at } = mature
          ? driveToReview(scheduler, NOW)
          : { snap: newCardSnapshot(NOW), at: NOW };

        const promised = previewIntervals(scheduler, snap, at)[rating];
        const after = applyReview(scheduler, snap, rating, at);
        const actual = humanizeInterval(new Date(after.due).getTime() - at.getTime());

        expect(promised).toBe(actual);
      });
    }
  }
});

// --- cykl karty ------------------------------------------------------------

it("swieza karta jest nowa, po pierwszej ocenie przestaje byc", () => {
  const scheduler = makeScheduler(SETTINGS);
  const snap = newCardSnapshot(NOW);
  expect(isNew(snap)).toBe(true);

  const after = applyReview(scheduler, snap, 3, NOW);
  expect(isNew(after)).toBe(false);
  expect(after.stability).toBeGreaterThan(0);
  expect(after.reps).toBe(1);
  expect(after.last_review).toBe(NOW.toISOString());
  expect(new Date(after.due).getTime()).toBeGreaterThan(NOW.getTime());
});

it("applyReview nie zmienia stanu wejsciowego", () => {
  // Repo zapisuje stateBefore do logu POD ocenie - gdyby biblioteka
  // mutowala wejscie, log klamalby po cichu.
  const scheduler = makeScheduler(SETTINGS);
  const snap = newCardSnapshot(NOW);
  const frozen = JSON.stringify(snap);

  applyReview(scheduler, snap, 3, NOW);

  expect(JSON.stringify(snap)).toBe(frozen);
});

it("Znowu w trakcie nauki nie jest wpadka", () => {
  const scheduler = makeScheduler(SETTINGS);
  const after = applyReview(scheduler, newCardSnapshot(NOW), 1, NOW);
  expect(after.lapses).toBe(0);
});

it("Znowu na karcie utrwalonej jest wpadka", () => {
  const scheduler = makeScheduler(SETTINGS);
  const { snap, at } = driveToReview(scheduler, NOW);
  expect(snap.lapses).toBe(0);

  const after = applyReview(scheduler, snap, 1, at);
  expect(after.lapses).toBe(1);
});

it("lepsza ocena odsuwa karte dalej", () => {
  const scheduler = makeScheduler(SETTINGS, { enableFuzz: false });
  const { snap, at } = driveToReview(scheduler, NOW);

  const dues = ([1, 2, 3, 4] as Rating[]).map((rating) =>
    new Date(applyReview(scheduler, snap, rating, at).due).getTime(),
  );
  expect([...dues].sort((a, b) => a - b)).toEqual(dues);
});

it("wyzsza zadana skutecznosc skraca interwaly", () => {
  const careful = makeScheduler({ desiredRetention: 0.95, fsrsParameters: null }, { enableFuzz: false });
  const relaxed = makeScheduler({ desiredRetention: 0.8, fsrsParameters: null }, { enableFuzz: false });

  const a = driveToReview(careful, NOW);
  const b = driveToReview(relaxed, NOW);
  const intervalA = new Date(applyReview(careful, a.snap, 3, a.at).due).getTime() - a.at.getTime();
  const intervalB = new Date(applyReview(relaxed, b.snap, 3, b.at).due).getTime() - b.at.getTime();

  expect(intervalA).toBeLessThan(intervalB);
});

it("szansa odpowiedzi spada z czasem", () => {
  const scheduler = makeScheduler(SETTINGS);
  const { snap, at } = driveToReview(scheduler, NOW);

  const soon = retrievability(scheduler, snap, at);
  const muchLater = retrievability(scheduler, snap, new Date(at.getTime() + 365 * 24 * 3600_000));

  expect(soon).toBeGreaterThan(muchLater);
  expect(soon).toBeLessThanOrEqual(1);
  expect(muchLater).toBeGreaterThanOrEqual(0);
});

// --- konwersja -------------------------------------------------------------

it("konwersja tam i z powrotem nic nie gubi", () => {
  const scheduler = makeScheduler(SETTINGS);
  const { snap } = driveToReview(scheduler, NOW);
  expect(toSnapshot(fromSnapshot(snap))).toEqual(snap);
});

// --- czas ------------------------------------------------------------------

describe("granica dnia nauki o 4:00 czasu lokalnego", () => {
  it("2:30 w nocy liczy sie do dnia poprzedniego", () => {
    expect(dayStart(new Date(2026, 0, 15, 2, 30))).toEqual(new Date(2026, 0, 14, 4, 0));
  });
  it("4:00 zaczyna nowy dzien", () => {
    expect(dayStart(new Date(2026, 0, 15, 4, 0))).toEqual(new Date(2026, 0, 15, 4, 0));
  });
  it("wieczor nalezy do biezacego dnia", () => {
    expect(dayStart(new Date(2026, 0, 15, 23, 0))).toEqual(new Date(2026, 0, 15, 4, 0));
  });
});

describe("etykiety interwalow", () => {
  const MIN = 60_000;
  const cases: Array<[number, string]> = [
    [0, "1 min"],
    [30_000, "1 min"],
    [-600_000, "1 min"], // karta zalegla - nigdy ujemna etykieta
    [10 * MIN, "10 min"],
    [59 * MIN, "59 min"],
    [60 * MIN, "1 godz."],
    [23 * 60 * MIN + 59 * MIN, "23 godz."],
    [24 * 60 * MIN, "1 dzień"],
    [2 * 24 * 60 * MIN, "2 dni"],
    [29 * 24 * 60 * MIN, "29 dni"],
    [30 * 24 * 60 * MIN, "1 mies."],
    [330 * 24 * 60 * MIN, "11 mies."],
    [730 * 24 * 60 * MIN, "2,0 lat"],
  ];
  for (const [ms, expected] of cases) {
    it(`${ms} ms -> ${expected}`, () => {
      expect(humanizeInterval(ms)).toBe(expected);
    });
  }
});
