/**
 * Testy statystyk (fake-indexeddb). Wpisy logu skladane recznie - testowanie
 * definicji metryk wymaga pelnej kontroli nad stanami i datami.
 *
 * Backendowa wersja tych statystyk nigdy nie doczekala sie testow (wymagala
 * zywego PostgreSQL) - port dostaje je pierwszy.
 */

import "fake-indexeddb/auto";

import { beforeEach, expect, it } from "vitest";

import type { ItemKind, Rating } from "@/lib/types";

import { closeAndDeleteDb, db } from "./db";
import { createDeck, createNote, deleteNote } from "./repo";
import {
  byItemKind,
  byTag,
  forecast,
  leeches,
  overview,
  studyDay,
} from "./stats";
import type { FsrsSnapshot } from "./types";

const NOW = new Date("2026-08-03T12:00:00");

beforeEach(async () => {
  await closeAndDeleteDb();
});

function snap(state: number, stability = 0, extra?: Partial<FsrsSnapshot>): FsrsSnapshot {
  return {
    due: NOW.toISOString(),
    stability,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state,
    ...extra,
  };
}

interface EntrySpec {
  deckId: string;
  cardId?: string;
  itemKind?: ItemKind;
  rating: Rating;
  at?: Date;
  /** Stan karty w chwili powtorki: 1 = nauka, 2 = nauczona. */
  state?: number;
  stability?: number;
  durationMs?: number;
}

async function seedEntry(spec: EntrySpec): Promise<void> {
  const database = await db();
  await database.put("reviewLog", {
    id: crypto.randomUUID(),
    cardId: spec.cardId ?? crypto.randomUUID(),
    deckId: spec.deckId,
    itemKind: spec.itemKind ?? "word",
    rating: spec.rating,
    reviewDatetime: (spec.at ?? NOW).toISOString(),
    durationMs: spec.durationMs ?? 3000,
    stateBefore: snap(spec.state ?? 2, spec.stability ?? 25),
    stateAfter: snap(2, (spec.stability ?? 25) + 1),
    scheduler: "test",
  });
}

// --- rzeczywista skutecznosc -----------------------------------------------

it("skutecznosc liczy tylko powtorki kart nauczonych", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  // Nauczone: 2 zaliczone, 1 wpadka -> 2/3.
  await seedEntry({ deckId: deck.id, rating: 3, state: 2 });
  await seedEntry({ deckId: deck.id, rating: 4, state: 2 });
  await seedEntry({ deckId: deck.id, rating: 1, state: 2 });
  // "Znowu" w trakcie nauki - normalne kroki, nie moga zanizac wyniku.
  for (let i = 0; i < 5; i += 1) {
    await seedEntry({ deckId: deck.id, rating: 1, state: 1, stability: 0 });
  }

  const stats = await overview({ now: NOW });
  expect(stats.retention).toBeCloseTo(2 / 3, 3);
  expect(stats.retentionSample).toBe(3);
  expect(stats.reviews).toBe(8); // wszystkie powtorki licza sie do aktywnosci
});

it("skutecznosc dzieli sie na materia swiezy i utrwalony po stabilnosci", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  await seedEntry({ deckId: deck.id, rating: 3, state: 2, stability: 5 }); // swiezy, ok
  await seedEntry({ deckId: deck.id, rating: 1, state: 2, stability: 30 }); // utrwalony, wpadka

  const stats = await overview({ now: NOW });
  expect(stats.retentionYoung).toBe(1);
  expect(stats.retentionMature).toBe(0);
});

it("histogram ocen, dotkniete karty i czas sumuja sie z okna", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  const cardId = crypto.randomUUID();
  await seedEntry({ deckId: deck.id, cardId, rating: 3, durationMs: 4000 });
  await seedEntry({ deckId: deck.id, cardId, rating: 1, durationMs: 6000 });
  await seedEntry({ deckId: deck.id, rating: 3, durationMs: 2000 });
  // Poza oknem 30 dni - ma zniknac ze wszystkiego poza reviewsAllTime.
  await seedEntry({
    deckId: deck.id,
    rating: 4,
    at: new Date("2026-06-01T12:00:00"),
  });

  const stats = await overview({ now: NOW, days: 30 });
  expect(stats.ratings).toEqual({ "1": 1, "3": 2 });
  expect(stats.cardsTouched).toBe(2);
  expect(stats.totalSeconds).toBe(12);
  expect(stats.reviews).toBe(3);
  expect(stats.reviewsAllTime).toBe(4);
});

// --- passa i przelom doby ---------------------------------------------------

it("nauka po polnocy liczy sie do dnia poprzedniego", () => {
  expect(studyDay(new Date("2026-08-02T02:30:00"))).toBe("2026-08-01");
  expect(studyDay(new Date("2026-08-02T04:00:00"))).toBe("2026-08-02");
});

it("passa liczy kolejne dni nauki, sesja nocna podtrzymuje ja", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  await seedEntry({ deckId: deck.id, rating: 3, at: new Date("2026-08-03T11:00:00") });
  await seedEntry({ deckId: deck.id, rating: 3, at: new Date("2026-08-02T12:00:00") });
  // 2:30 w nocy 2 sierpnia = dzien nauki 1 sierpnia.
  await seedEntry({ deckId: deck.id, rating: 3, at: new Date("2026-08-02T02:30:00") });

  expect((await overview({ now: NOW })).streakDays).toBe(3);
});

it("dziura w historii przerywa passe, brak powtorki dzis jeszcze nie", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  await seedEntry({ deckId: deck.id, rating: 3, at: new Date("2026-08-03T11:00:00") });
  await seedEntry({ deckId: deck.id, rating: 3, at: new Date("2026-08-01T12:00:00") });
  expect((await overview({ now: NOW })).streakDays).toBe(1);

  await closeAndDeleteDb();
  const fresh = await createDeck({ name: "T" }, NOW);
  await seedEntry({ deckId: fresh.id, rating: 3, at: new Date("2026-08-02T12:00:00") });
  expect((await overview({ now: NOW })).streakDays).toBe(1);
});

// --- kategorie materialu ----------------------------------------------------

it("mala proba daje null zamiast skutecznosci - szum to nie sygnal", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  for (let i = 0; i < 19; i += 1) {
    await seedEntry({ deckId: deck.id, itemKind: "word", rating: 3, state: 2 });
  }

  let [words] = await byItemKind({ now: NOW });
  expect(words.retentionSample).toBe(19);
  expect(words.retention).toBeNull(); // 19 < 20

  await seedEntry({ deckId: deck.id, itemKind: "word", rating: 3, state: 2 });
  [words] = await byItemKind({ now: NOW });
  expect(words.retentionSample).toBe(20);
  expect(words.retention).toBe(1);
});

it("kategorie z logu przezywaja skasowanie notatki", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  const { note, cards } = await createNote(
    {
      deckId: deck.id,
      noteType: "basic",
      fields: { Front: "kick the bucket", Back: "kopnac w kalendarz" },
      itemKind: "expression",
    },
    NOW,
  );
  await seedEntry({ deckId: deck.id, cardId: cards[0].id, itemKind: "expression", rating: 3 });

  await deleteNote(note.id);

  const rows = await byItemKind({ now: NOW });
  const expressions = rows.find((row) => row.itemKind === "expression");
  expect(expressions).toBeDefined();
  expect(expressions!.reviews).toBe(1); // historia zostala
  expect(expressions!.cards).toBe(0); // zywego materialu juz nie ma
});

it("statystyki kart licza tylko zywy material i pomijaja nowe przy srednich", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  const seen = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "pies", Back: "dog" } },
    NOW,
  );
  const database = await db();
  const card = (await database.get("cards", seen.cards[0].id))!;
  card.fsrs = snap(2, 10, { lapses: 2, reps: 5 });
  await database.put("cards", card);

  const [words] = await byItemKind({ now: NOW });
  expect(words.cards).toBe(2);
  expect(words.newCards).toBe(1);
  expect(words.lapses).toBe(2);
  // Srednia stabilnosc z jednej widzianej karty, nie z dwoch.
  expect(words.avgStabilityDays).toBe(10);
});

// --- tagi -------------------------------------------------------------------

it("tagi agreguja powtorki swoich notatek", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  const { cards } = await createNote(
    {
      deckId: deck.id,
      noteType: "basic",
      fields: { Front: "obs", Back: "parametry" },
      tags: ["oet", "nhs"],
    },
    NOW,
  );
  await seedEntry({ deckId: deck.id, cardId: cards[0].id, rating: 3 });
  await seedEntry({ deckId: deck.id, cardId: cards[0].id, rating: 1 });

  const tags = await byTag({ now: NOW });
  expect(tags).toHaveLength(2);
  const oet = tags.find((t) => t.tag === "oet")!;
  expect(oet.reviews).toBe(2);
  expect(oet.cards).toBe(1);
  expect(oet.retention).toBeNull(); // proba 2 < 20
});

// --- prognoza i problemy ----------------------------------------------------

it("prognoza grupuje po dniu terminu i pomija karty nowe", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  const database = await db();
  const put = async (due: string, state: number) => {
    const { cards } = await createNote(
      { deckId: deck.id, noteType: "basic", fields: { Front: crypto.randomUUID(), Back: "x" } },
      NOW,
    );
    const card = (await database.get("cards", cards[0].id))!;
    card.fsrs = snap(state, 5, { due });
    card.due = due;
    await database.put("cards", card);
  };

  const tomorrow = new Date("2026-08-04T10:00:00").toISOString();
  await put(tomorrow, 2);
  await put(tomorrow, 2);
  await put(new Date("2026-08-02T10:00:00").toISOString(), 2); // zalegla
  await put(new Date("2026-12-01T10:00:00").toISOString(), 2); // poza horyzontem
  await put(tomorrow, 0); // nowa - nie jest "do powtorki"

  const points = await forecast({ now: NOW, days: 14 });
  expect(points).toEqual([
    { day: "2026-08-02", count: 1 },
    { day: "2026-08-04", count: 2 },
  ]);
});

it("problemy sortuja sie po wpadkach, prog 8 oznacza pijawke", async () => {
  const deck = await createDeck({ name: "T" }, NOW);
  const database = await db();
  const withLapses = async (front: string, lapses: number) => {
    const { cards } = await createNote(
      { deckId: deck.id, noteType: "basic", fields: { Front: front, Back: "x" } },
      NOW,
    );
    const card = (await database.get("cards", cards[0].id))!;
    card.fsrs = snap(2, 3, { lapses, reps: lapses + 2 });
    await database.put("cards", card);
  };
  await withLapses("uparta", 9);
  await withLapses("trudna", 3);

  const rows = await leeches({ now: NOW });
  expect(rows.map((r) => r.front)).toEqual(["uparta", "trudna"]);
  expect(rows[0].isLeech).toBe(true);
  expect(rows[1].isLeech).toBe(false);
  expect(rows[0].deckName).toBe("T");
});

// --- zakres talii -----------------------------------------------------------

it("statystyki daja sie zawezic do jednej talii", async () => {
  const a = await createDeck({ name: "A" }, NOW);
  const b = await createDeck({ name: "B" }, NOW);
  await seedEntry({ deckId: a.id, rating: 3 });
  await seedEntry({ deckId: b.id, rating: 3 });
  await seedEntry({ deckId: b.id, rating: 1 });

  expect((await overview({ now: NOW })).reviews).toBe(3);
  expect((await overview({ now: NOW, deckId: a.id })).reviews).toBe(1);
  expect((await overview({ now: NOW, deckId: b.id })).reviews).toBe(2);
});
