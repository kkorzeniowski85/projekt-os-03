/**
 * Statystyki liczone z lokalnego logu powtorek - port
 * backend/app/services/stats.py (definicje metryk: ADR 0005).
 *
 * Nic nie jest cache'owane: kazda liczba powstaje z przejscia po logu, wiec
 * statystyka nie moze rozjechac sie ze stanem kart. Przy kolekcji osobistej
 * (tysiace wpisow) to jest tanie.
 *
 * Kluczowa metryka to rzeczywista skutecznosc (true retention): odsetek
 * powtorek zaliczonych sposrod kart bedacych w stanie Review. Powtorek
 * w trakcie nauki nie wliczamy - tam "Znowu" jest normalnym krokiem
 * algorytmu, nie porazka, wiec zanizaloby wynik.
 *
 * Roznica wobec backendu, celowa (ADR 0006): statystyki powtorek czytaja
 * kategorie materialu z logu (zdenormalizowana), nie z notatki - dzieki temu
 * obejmuja takze material, ktory zostal juz skasowany.
 */

import type { ItemKind } from "@/lib/types";

import { db } from "./db";
import { isNew } from "./scheduler";
import { dayStart } from "./time";
import type { CardRecord, NoteRecord, ReviewLogRecord } from "./types";

//: Prog dojrzalosci karty w dniach. Karta o mniejszej stabilnosci jest
//: "swieza" - jej zapomnienie znaczy co innego niz zapomnienie materialu
//: utrwalonego.
export const MATURE_STABILITY_DAYS = 21;

//: Od tylu wpadek karta trafia na liste problemow (prog z Anki).
export const LEECH_LAPSES = 8;

//: Ponizej tylu powtorek w grupie skutecznosc jest szumem, nie sygnalem.
export const MIN_REVIEWS_FOR_SIGNAL = 20;

const STATE_REVIEW = 2;

export interface StatsScope {
  deckId?: string | null;
  days?: number;
  now?: Date;
}

// --- czas ------------------------------------------------------------------

/** Data "dnia nauki" (lokalna, z przelomem doby o 4:00) jako YYYY-MM-DD. */
export function studyDay(at: Date): string {
  // Ta sama granica co w kolejce nauki (dayStart), nie "minus 4 godziny":
  // w noc zmiany czasu te dwie miary sie rozjezdzaly i statystyki liczyly
  // nauke do innego dnia niz kolejka.
  const start = dayStart(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

function previousDay(day: string): string {
  // Kotwica w poludnie - odejmowanie doby nie potyka sie o zmiane czasu.
  const anchor = new Date(`${day}T12:00:00`);
  anchor.setDate(anchor.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}-${pad(anchor.getDate())}`;
}

// --- wspolne ---------------------------------------------------------------

function round(value: number | null, digits = 3): number | null {
  if (value === null || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const isReviewState = (entry: ReviewLogRecord) => entry.stateBefore.state === STATE_REVIEW;
const isSuccess = (entry: ReviewLogRecord) => entry.rating > 1;

/** Odsetek zaliczonych wsrod powtorek kart nauczonych. null, gdy brak proby. */
function retention(entries: ReviewLogRecord[]): { value: number | null; sample: number } {
  const scoped = entries.filter(isReviewState);
  if (scoped.length === 0) return { value: null, sample: 0 };
  const successes = scoped.filter(isSuccess).length;
  return { value: successes / scoped.length, sample: scoped.length };
}

async function loadLog(scope: StatsScope): Promise<ReviewLogRecord[]> {
  const database = await db();
  const all = await database.getAll("reviewLog");
  return scope.deckId ? all.filter((entry) => entry.deckId === scope.deckId) : all;
}

async function loadCards(scope: StatsScope): Promise<CardRecord[]> {
  const database = await db();
  return scope.deckId
    ? database.getAllFromIndex("cards", "by-deck", scope.deckId)
    : database.getAll("cards");
}

async function noteMap(): Promise<Map<string, NoteRecord>> {
  const database = await db();
  return new Map((await database.getAll("notes")).map((note) => [note.id, note]));
}

function inWindow(entries: ReviewLogRecord[], now: Date, days: number): ReviewLogRecord[] {
  const since = new Date(now.getTime() - days * 24 * 3600_000).toISOString();
  return entries.filter((entry) => entry.reviewDatetime >= since);
}

// --- przeglad --------------------------------------------------------------

export interface DailyPoint {
  day: string;
  reviews: number;
  seconds: number;
  retention: number | null;
}

export interface Overview {
  days: number;
  reviews: number;
  reviewsAllTime: number;
  cardsTouched: number;
  totalSeconds: number;
  secondsPerReview: number | null;
  retention: number | null;
  retentionYoung: number | null;
  retentionMature: number | null;
  /** Bez tej liczby skutecznosc jest nieinterpretowalna - 100% z trzech
   *  powtorek nie znaczy nic. */
  retentionSample: number;
  streakDays: number;
  daily: DailyPoint[];
  ratings: Record<string, number>;
}

export async function overview(scope: StatsScope = {}): Promise<Overview> {
  const now = scope.now ?? new Date();
  const days = scope.days ?? 30;
  const all = await loadLog(scope);
  const windowed = inWindow(all, now, days);

  const overall = retention(windowed);
  const young = retention(
    windowed.filter((e) => (e.stateBefore.stability ?? 0) < MATURE_STABILITY_DAYS),
  );
  const mature = retention(
    windowed.filter((e) => (e.stateBefore.stability ?? 0) >= MATURE_STABILITY_DAYS),
  );

  const totalMs = windowed.reduce((sum, e) => sum + e.durationMs, 0);

  const byDay = new Map<string, ReviewLogRecord[]>();
  for (const entry of windowed) {
    const day = studyDay(new Date(entry.reviewDatetime));
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(entry);
  }
  const daily: DailyPoint[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, entries]) => ({
      day,
      reviews: entries.length,
      seconds: Math.round(entries.reduce((s, e) => s + e.durationMs, 0) / 1000),
      retention: round(retention(entries).value),
    }));

  const ratings: Record<string, number> = {};
  for (const entry of windowed) {
    ratings[String(entry.rating)] = (ratings[String(entry.rating)] ?? 0) + 1;
  }

  return {
    days,
    reviews: windowed.length,
    reviewsAllTime: all.length,
    cardsTouched: new Set(windowed.map((e) => e.cardId)).size,
    totalSeconds: Math.round(totalMs / 1000),
    secondsPerReview: windowed.length ? round(totalMs / 1000 / windowed.length, 1) : null,
    retention: round(overall.value),
    retentionYoung: round(young.value),
    retentionMature: round(mature.value),
    retentionSample: overall.sample,
    streakDays: streak(new Set(byDay.keys()), now),
    daily,
    ratings,
  };
}

/** Liczba kolejnych dni nauki liczac wstecz od dzis (albo wczoraj). */
function streak(days: Set<string>, now: Date): number {
  if (days.size === 0) return 0;
  const today = studyDay(now);
  // Dzien jeszcze trwa, wiec brak powtorki dzis nie zeruje passy.
  let cursor = days.has(today) ? today : previousDay(today);
  let count = 0;
  while (days.has(cursor)) {
    count += 1;
    cursor = previousDay(cursor);
  }
  return count;
}

// --- podzial na kategorie ---------------------------------------------------

export interface ItemKindStats {
  itemKind: ItemKind;
  cards: number;
  notes: number;
  newCards: number;
  reviews: number;
  retention: number | null;
  retentionSample: number;
  avgStabilityDays: number | null;
  avgDifficulty: number | null;
  lapses: number;
  secondsPerReview: number | null;
}

/**
 * Skutecznosc i obciazenie osobno dla slow, fraz, wyrazen i zdan.
 *
 * To jest podstawa decyzji, o ktore kategorie trzeba zadbac inaczej: jesli
 * zdania maja 70%, a slowa 95%, to nie przypadek, tylko sygnal, ze zdania
 * wymagaja innego traktowania.
 */
export async function byItemKind(scope: StatsScope = {}): Promise<ItemKindStats[]> {
  const now = scope.now ?? new Date();
  const days = scope.days ?? 30;
  const windowed = inWindow(await loadLog(scope), now, days);
  const cards = await loadCards(scope);
  const notes = await noteMap();

  const kinds = new Map<
    ItemKind,
    {
      entries: ReviewLogRecord[];
      cards: number;
      noteIds: Set<string>;
      newCards: number;
      stability: number[];
      difficulty: number[];
      lapses: number;
    }
  >();
  const bucket = (kind: ItemKind) => {
    let existing = kinds.get(kind);
    if (!existing) {
      existing = {
        entries: [],
        cards: 0,
        noteIds: new Set(),
        newCards: 0,
        stability: [],
        difficulty: [],
        lapses: 0,
      };
      kinds.set(kind, existing);
    }
    return existing;
  };

  // Strona powtorek: kategoria z logu - obejmuje material juz skasowany.
  for (const entry of windowed) bucket(entry.itemKind).entries.push(entry);

  // Strona kart: tylko zywy material.
  for (const card of cards) {
    const note = notes.get(card.noteId);
    if (!note) continue;
    const stats = bucket(note.itemKind);
    stats.cards += 1;
    stats.noteIds.add(note.id);
    stats.lapses += card.fsrs.lapses;
    if (isNew(card.fsrs)) {
      stats.newCards += 1;
    } else {
      // Srednie tylko po kartach widzianych - swieza karta ma zerowa
      // stabilnosc "z definicji", nie z pomiaru.
      stats.stability.push(card.fsrs.stability);
      stats.difficulty.push(card.fsrs.difficulty);
    }
  }

  const avg = (values: number[]) =>
    values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

  const out: ItemKindStats[] = [...kinds.entries()].map(([itemKind, stats]) => {
    const { value, sample } = retention(stats.entries);
    return {
      itemKind,
      cards: stats.cards,
      notes: stats.noteIds.size,
      newCards: stats.newCards,
      reviews: stats.entries.length,
      retention: sample >= MIN_REVIEWS_FOR_SIGNAL ? round(value) : null,
      retentionSample: sample,
      avgStabilityDays: round(avg(stats.stability), 1),
      avgDifficulty: round(avg(stats.difficulty), 2),
      lapses: stats.lapses,
      secondsPerReview: stats.entries.length
        ? round(
            stats.entries.reduce((s, e) => s + e.durationMs, 0) / 1000 / stats.entries.length,
            1,
          )
        : null,
    };
  });

  return out.sort((a, b) => b.cards - a.cards);
}

export interface TagStats {
  tag: string;
  cards: number;
  reviews: number;
  retention: number | null;
  retentionSample: number;
}

export async function byTag(scope: StatsScope & { limit?: number } = {}): Promise<TagStats[]> {
  const now = scope.now ?? new Date();
  const days = scope.days ?? 30;
  const limit = scope.limit ?? 20;
  const windowed = inWindow(await loadLog(scope), now, days);

  const database = await db();
  const cardToNote = new Map(
    (await database.getAll("cards")).map((card) => [card.id, card.noteId]),
  );
  const notes = await noteMap();

  const tags = new Map<string, { entries: ReviewLogRecord[]; cardIds: Set<string> }>();
  for (const entry of windowed) {
    const note = notes.get(cardToNote.get(entry.cardId) ?? "");
    if (!note) continue; // tagow nie denormalizujemy - material skasowany wypada
    for (const tag of note.tags) {
      let stats = tags.get(tag);
      if (!stats) {
        stats = { entries: [], cardIds: new Set() };
        tags.set(tag, stats);
      }
      stats.entries.push(entry);
      stats.cardIds.add(entry.cardId);
    }
  }

  return [...tags.entries()]
    .map(([tag, stats]) => {
      const { value, sample } = retention(stats.entries);
      return {
        tag,
        cards: stats.cardIds.size,
        reviews: stats.entries.length,
        retention: sample >= MIN_REVIEWS_FOR_SIGNAL ? round(value) : null,
        retentionSample: sample,
      };
    })
    .sort((a, b) => b.reviews - a.reviews)
    .slice(0, limit);
}

// --- material problematyczny ------------------------------------------------

export interface LeechCard {
  cardId: string;
  noteId: string;
  front: string;
  back: string;
  itemKind: ItemKind;
  deckName: string;
  lapses: number;
  reps: number;
  stabilityDays: number | null;
  difficulty: number | null;
  isLeech: boolean;
}

/**
 * Karty, ktore uporczywie nie chca sie utrwalic. Duzo wpadek przy niskiej
 * stabilnosci zwykle nie znaczy "powtarzaj wiecej", tylko "fiszka jest zle
 * sformulowana" (za duzo tresci naraz, myli sie z inna, brak kontekstu).
 */
export async function leeches(scope: StatsScope & { limit?: number } = {}): Promise<LeechCard[]> {
  const limit = scope.limit ?? 20;
  const cards = (await loadCards(scope)).filter((card) => card.fsrs.lapses > 0);
  const notes = await noteMap();
  const database = await db();
  const decks = new Map((await database.getAll("decks")).map((deck) => [deck.id, deck.name]));

  return cards
    .map((card) => ({ card, note: notes.get(card.noteId) }))
    .filter((pair): pair is { card: CardRecord; note: NoteRecord } => !!pair.note)
    .sort(
      (a, b) =>
        b.card.fsrs.lapses - a.card.fsrs.lapses ||
        a.card.fsrs.stability - b.card.fsrs.stability,
    )
    .slice(0, limit)
    .map(({ card, note }) => ({
      cardId: card.id,
      noteId: note.id,
      front: note.fields.Front ?? "",
      back: note.fields.Back ?? "",
      itemKind: note.itemKind,
      deckName: decks.get(card.deckId) ?? "?",
      lapses: card.fsrs.lapses,
      reps: card.fsrs.reps,
      stabilityDays: isNew(card.fsrs) ? null : round(card.fsrs.stability, 1),
      difficulty: isNew(card.fsrs) ? null : round(card.fsrs.difficulty, 2),
      isLeech: card.fsrs.lapses >= LEECH_LAPSES,
    }));
}

// --- prognoza obciazenia ----------------------------------------------------

export interface ForecastPoint {
  day: string;
  count: number;
}

/**
 * Ile kart wypadnie do powtorki w kolejnych dniach. Dni przesle to zaleglosci.
 * Sluzy do wylapania kumulacji zanim sie wydarzy.
 */
export async function forecast(scope: StatsScope = {}): Promise<ForecastPoint[]> {
  const now = scope.now ?? new Date();
  const days = scope.days ?? 14;
  const horizon = new Date(now.getTime() + days * 24 * 3600_000).toISOString();

  const cards = (await loadCards(scope)).filter(
    (card) => !isNew(card.fsrs) && card.due <= horizon,
  );

  const byDay = new Map<string, number>();
  for (const card of cards) {
    const day = studyDay(new Date(card.due));
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));
}
