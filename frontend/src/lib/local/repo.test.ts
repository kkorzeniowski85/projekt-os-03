/**
 * Testy warstwy operacji na IndexedDB (fake-indexeddb, bez przegladarki).
 * Kazdy test dostaje swieza baze.
 */

import "fake-indexeddb/auto";

import { beforeEach, expect, it } from "vitest";

import { contentHash } from "./content";
import { closeAndDeleteDb } from "./db";
import {
  createDeck,
  createNote,
  deleteDeck,
  deleteNote,
  findDuplicateByHash,
  listDecks,
  listNotes,
  studyQueue,
  submitReview,
  updateDeck,
  updateNote,
} from "./repo";
import { db } from "./db";

const NOW = new Date("2026-08-03T12:00:00");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

beforeEach(async () => {
  await closeAndDeleteDb();
});

// --- talie i notatki -------------------------------------------------------

it("notatka dwustronna daje dwie karty, jednostronna jedna", async () => {
  const deck = await createDeck({ name: "Angielski" }, NOW);

  const twoSided = await createNote(
    { deckId: deck.id, noteType: "basic_reversed", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  expect(twoSided.cards.map((c) => c.templateOrd)).toEqual([0, 1]);

  const oneSided = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "pies", Back: "dog" } },
    NOW,
  );
  expect(oneSided.cards).toHaveLength(1);

  const decks = await listDecks(NOW);
  expect(decks[0].counts).toEqual({ new: 3, due: 0, total: 3 });
});

it("kategoria materialu jest zgadywana z przodu, jawna wygrywa", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);

  const guessed = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  expect(guessed.note.itemKind).toBe("word");

  const explicit = await createNote(
    {
      deckId: deck.id,
      noteType: "basic",
      fields: { Front: "kick the bucket", Back: "kopnac w kalendarz" },
      itemKind: "expression",
    },
    NOW,
  );
  expect(explicit.note.itemKind).toBe("expression");
});

it("duplikat jest rozpoznawany mimo roznic formatowania", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { note } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );

  const hash = await contentHash({ Front: "  KOT ", Back: "cat" });
  expect((await findDuplicateByHash(hash))?.id).toBe(note.id);
});

it("pusta strona notatki jest odrzucana", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await expect(
    createNote({ deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "  " } }, NOW),
  ).rejects.toThrow("przod i tyl");
});

it("dwie talie o tej samej nazwie sa zabronione", async () => {
  await createDeck({ name: "Angielski" }, NOW);
  await expect(createDeck({ name: "Angielski" }, NOW)).rejects.toThrow("juz istnieje");
});

it("zmiana typu notatki dosztukowuje i usuwa karty bez ruszania istniejacych", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { note, cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  const originalCardId = cards[0].id;

  await updateNote(note.id, { noteType: "basic_reversed" }, at(1));
  let listed = (await listNotes(deck.id))[0];
  expect(listed.cards).toHaveLength(2);
  // Karta ord=0 przezyla zmiane - jej stan FSRS nie zostal zresetowany.
  expect(listed.cards[0].id).toBe(originalCardId);

  await updateNote(note.id, { noteType: "basic" }, at(2));
  listed = (await listNotes(deck.id))[0];
  expect(listed.cards).toHaveLength(1);
  expect(listed.cards[0].id).toBe(originalCardId);
});

// --- kolejka ---------------------------------------------------------------

it("kolejka szanuje dzienny limit nowych kart", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await updateDeck(deck.id, { newPerDay: 2 });
  for (const front of ["a", "b", "c"]) {
    await createNote({ deckId: deck.id, noteType: "basic", fields: { Front: front, Back: "x" } }, NOW);
  }

  const queue = await studyQueue(deck.id, { now: NOW });
  expect(queue.cards).toHaveLength(2);
  expect(queue.newRemaining).toBe(2);
  expect(queue.dueRemaining).toBe(0);
});

it("ocena zapisuje log, a kolejka liczy dzisiejsze nowe karty", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await updateDeck(deck.id, { newPerDay: 2 });
  for (const front of ["a", "b", "c"]) {
    await createNote({ deckId: deck.id, noteType: "basic", fields: { Front: front, Back: "x" } }, NOW);
  }

  const first = (await studyQueue(deck.id, { now: NOW })).cards[0];
  const { card, log } = await submitReview({
    cardId: first.card.id,
    rating: 3,
    durationMs: 4200,
    now: NOW,
  });

  expect(log.stateBefore.state).toBe(0); // karta byla nowa
  expect(log.stateAfter.state).not.toBe(0);
  expect(log.itemKind).toBe("word");
  expect(log.deckId).toBe(deck.id);
  expect(log.durationMs).toBe(4200);
  expect(card.due).toBe(card.fsrs.due);

  // Jedna nowa karta "zuzyta" dzis -> zostal 1 slot na nowe.
  const queue = await studyQueue(deck.id, { now: at(1) });
  expect(queue.newRemaining).toBe(1);
  const ids = queue.cards.map((entry) => entry.card.id);
  expect(ids).not.toContain(first.card.id); // wroci dopiero w swoim terminie
});

it("zalegle karty wracaja do kolejki przed nowymi", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  await createNote({ deckId: deck.id, noteType: "basic", fields: { Front: "pies", Back: "dog" } }, NOW);

  const reviewed = await submitReview({ cardId: cards[0].id, rating: 3, durationMs: 1000, now: NOW });

  // Chwile po terminie: oceniona karta jest zalegla i stoi przed nowa.
  const later = new Date(new Date(reviewed.card.due).getTime() + 60_000);
  const queue = await studyQueue(deck.id, { now: later });
  expect(queue.cards[0].card.id).toBe(cards[0].id);
  expect(queue.dueRemaining).toBe(1);
});

it("ocena bez czasu odpowiedzi jest odrzucana", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  await expect(
    submitReview({ cardId: cards[0].id, rating: 3, durationMs: Number.NaN, now: NOW }),
  ).rejects.toThrow("durationMs");
});

// --- kasowanie a historia --------------------------------------------------

it("skasowanie notatki nie kasuje historii powtorek", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { note, cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  await submitReview({ cardId: cards[0].id, rating: 3, durationMs: 1000, now: NOW });

  await deleteNote(note.id);

  const database = await db();
  expect(await database.getAllFromIndex("cards", "by-note", note.id)).toHaveLength(0);
  const history = await database.getAllFromIndex("reviewLog", "by-card", cards[0].id);
  expect(history).toHaveLength(1);
  expect(history[0].itemKind).toBe("word"); // denormalizacja robi swoje
});

it("skasowanie talii zabiera notatki i karty, zostawia log", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  await submitReview({ cardId: cards[0].id, rating: 3, durationMs: 1000, now: NOW });

  await deleteDeck(deck.id);

  const database = await db();
  expect(await database.getAll("decks")).toHaveLength(0);
  expect(await database.getAll("notes")).toHaveLength(0);
  expect(await database.getAll("cards")).toHaveLength(0);
  expect(await database.getAll("reviewLog")).toHaveLength(1);
});
