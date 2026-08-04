/**
 * Testy kopii zapasowej. To jedyne zabezpieczenie danych, ktore istnieja
 * w jednym miejscu na swiecie - stad nacisk na przypadki bledne.
 */

import "fake-indexeddb/auto";

import { beforeEach, expect, it } from "vitest";

import {
  BACKUP_FORMAT,
  backupFilename,
  exportBackup,
  parseBackup,
  restoreBackup,
  type BackupFile,
} from "./backup";
import { closeAndDeleteDb, db } from "./db";
import { createDeck, createNote, listDecks, listNotes, studyQueue, submitReview } from "./repo";
import { overview } from "./stats";

const NOW = new Date("2026-08-04T12:00:00");

beforeEach(async () => {
  await closeAndDeleteDb();
});

/** Talia z historia nauki - material do sprawdzenia, czy cos ginie. */
async function seedCollection() {
  const deck = await createDeck({ name: "OET" }, NOW);
  const { cards } = await createNote(
    {
      deckId: deck.id,
      noteType: "basic_reversed",
      fields: { Front: "to rule out", Back: "wykluczyć", Example: "Rule out a bleed." },
      tags: ["oet", "nhs"],
      itemKind: "expression",
    },
    NOW,
  );
  await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "obs", Back: "parametry" } },
    NOW,
  );
  await submitReview({ cardId: cards[0].id, rating: 3, durationMs: 4200, now: NOW });
  return deck;
}

it("eksport zbiera cala kolekcje razem z historia", async () => {
  await seedCollection();

  const payload = await exportBackup(NOW);

  expect(payload.format).toBe(BACKUP_FORMAT);
  expect(payload.exportedAt).toBe(NOW.toISOString());
  expect(payload.data.decks).toHaveLength(1);
  expect(payload.data.notes).toHaveLength(2);
  expect(payload.data.cards).toHaveLength(3); // dwustronna + jednostronna
  expect(payload.data.reviewLog).toHaveLength(1);
  expect(payload.data.settings).toHaveLength(1);
});

it("pelny obieg: eksport, wyczyszczenie, przywrocenie - nic nie ginie", async () => {
  await seedCollection();
  const before = {
    decks: await listDecks(NOW),
    stats: await overview({ now: NOW }),
  };
  const payload = await exportBackup(NOW);
  const asFile = JSON.stringify(payload);

  await closeAndDeleteDb(); // symulacja wyczyszczenia danych przegladarki
  expect((await listDecks(NOW))).toHaveLength(0);

  const counts = await restoreBackup(parseBackup(asFile));
  expect(counts).toEqual({ decks: 1, notes: 2, cards: 3, reviews: 1 });

  const after = { decks: await listDecks(NOW), stats: await overview({ now: NOW }) };
  expect(after.decks).toEqual(before.decks);
  expect(after.stats.reviews).toBe(before.stats.reviews);
  expect(after.stats.reviewsAllTime).toBe(1);

  // Tresc notatek i stan FSRS kart przezyly obieg w calosci.
  const notes = await listNotes(after.decks[0].id);
  const ruleOut = notes.find((n) => n.note.fields.Front === "to rule out")!;
  expect(ruleOut.note.fields.Example).toBe("Rule out a bleed.");
  expect(ruleOut.note.tags).toEqual(["nhs", "oet"]);
  expect(ruleOut.note.itemKind).toBe("expression");
  const reviewed = ruleOut.cards.find((c) => c.fsrs.reps > 0)!;
  expect(reviewed.fsrs.state).not.toBe(0);
  expect(reviewed.due).toBe(reviewed.fsrs.due);
});

it("po przywroceniu nauka toczy sie dalej, a nie od zera", async () => {
  const deck = await seedCollection();
  const payload = await exportBackup(NOW);
  const queueBefore = await studyQueue(deck.id, { now: NOW });

  await closeAndDeleteDb();
  await restoreBackup(payload);

  const queueAfter = await studyQueue(deck.id, { now: NOW });
  expect(queueAfter.cards.map((c) => c.card.id)).toEqual(
    queueBefore.cards.map((c) => c.card.id),
  );
  // Oceniona karta nadal nie jest nowa - limit dzienny tez o tym pamieta.
  expect(queueAfter.newRemaining).toBe(queueBefore.newRemaining);
});

it("przywrocenie zastepuje istniejaca kolekcje, nie dokleja sie do niej", async () => {
  await seedCollection();
  const payload = await exportBackup(NOW);

  await closeAndDeleteDb();
  await createDeck({ name: "Cos innego" }, NOW);

  await restoreBackup(payload);

  const decks = await listDecks(NOW);
  expect(decks).toHaveLength(1);
  expect(decks[0].name).toBe("OET");
});

// --- odmowy ----------------------------------------------------------------

it("plik w formacie fiszki/v1 dostaje odmowe z podpowiedzia", () => {
  const deckFile = JSON.stringify({ format: "fiszki/v1", notes: [{ front: "a", back: "b" }] });
  expect(() => parseBackup(deckFile)).toThrow(/ekran Import/);
});

it("nie-JSON i uszkodzona kopia sa odrzucane", () => {
  expect(() => parseBackup("to nie jest json")).toThrow(/JSON/);
  expect(() =>
    parseBackup(JSON.stringify({ format: BACKUP_FORMAT, data: { decks: [] } })),
  ).toThrow(/uszkodzona/);
});

it("uszkodzona kopia nie kasuje istniejacych danych", async () => {
  await seedCollection();

  const broken = {
    format: BACKUP_FORMAT,
    exportedAt: NOW.toISOString(),
    schema: 1,
    // Notatka bez id - IndexedDB odrzuci put(), transakcja ma sie wycofac.
    data: {
      decks: [],
      notes: [{ deckId: "x", fields: {} }],
      cards: [],
      reviewLog: [],
      settings: [],
    },
  } as unknown as BackupFile;

  await expect(restoreBackup(broken)).rejects.toThrow();

  // Stara kolekcja nietknieta - to jest cala wartosc jednej transakcji.
  const database = await db();
  expect(await database.count("decks")).toBe(1);
  expect(await database.count("notes")).toBe(2);
  expect(await database.count("reviewLog")).toBe(1);
});

it("nazwa pliku niesie lokalna date i godzine", () => {
  expect(backupFilename(new Date("2026-08-04T19:30:00"))).toBe(
    "fiszki-kopia-2026-08-04-1930.json",
  );
});
