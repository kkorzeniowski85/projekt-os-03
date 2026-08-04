/** Testy zapisu importu do IndexedDB (fake-indexeddb). */

import "fake-indexeddb/auto";

import { beforeEach, expect, it } from "vitest";

import { closeAndDeleteDb, db } from "../db";
import { createDeck, listNotes } from "../repo";
import { parseSource } from "./index";
import { commitImport, duplicateSummary, normalize } from "./service";

const utf8 = (text: string) => new TextEncoder().encode(text);
const NOW = new Date("2026-08-03T12:00:00");

beforeEach(async () => {
  await closeAndDeleteDb();
});

async function draftsFrom(name: string, content: string) {
  const result = parseSource(name, utf8(content));
  return normalize(result, result.suggestedMapping);
}

it("import tworzy notatki i karty, ponowny import wszystko pomija", async () => {
  const deck = await createDeck({ name: "OET" }, NOW);
  const drafts = await draftsFrom(
    "talia.csv",
    "Term;Definition;Example\nubiquitous;wszechobecny;It is ubiquitous.\nkot;cat;\n",
  );

  const first = await commitImport(deck.id, drafts, { noteType: "basic_reversed", now: NOW });
  expect(first).toEqual({ imported: 2, skippedDuplicates: 0, skippedInvalid: 0 });

  const listed = await listNotes(deck.id);
  expect(listed).toHaveLength(2);
  const ubiquitous = listed.map((n) => n.note).find((n) => n.fields.Front === "ubiquitous")!;
  expect(ubiquitous.fields.Example).toBe("It is ubiquitous.");
  expect(ubiquitous.itemKind).toBe("word");
  expect(listed.every(({ cards }) => cards.length === 2)).toBe(true);

  // Deduplikacja po tresci: ten sam plik drugi raz nie tworzy niczego.
  const again = await commitImport(deck.id, drafts, { noteType: "basic_reversed", now: NOW });
  expect(again).toEqual({ imported: 0, skippedDuplicates: 2, skippedInvalid: 0 });
  expect(await listNotes(deck.id)).toHaveLength(2);
});

it("duplikaty wewnatrz pliku sa pomijane, chyba ze wylaczono pomijanie", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const drafts = await draftsFrom("t.csv", "front,back\nkot,cat\nKOT,cat\n");

  const summary = await duplicateSummary(drafts);
  expect(summary).toEqual({ total: 2, unique: 1, duplicatesInFile: 1, alreadyInCollection: 0 });

  const skipping = await commitImport(deck.id, drafts, { noteType: "basic", now: NOW });
  expect(skipping.imported).toBe(1);
  expect(skipping.skippedDuplicates).toBe(1);

  await closeAndDeleteDb();
  const freshDeck = await createDeck({ name: "Talia" }, NOW);
  const keeping = await commitImport(freshDeck.id, drafts, {
    noteType: "basic",
    skipDuplicates: false,
    now: NOW,
  });
  expect(keeping.imported).toBe(2);
});

it("note_type ze zrodla wygrywa z typem wybranym przy imporcie", async () => {
  const deck = await createDeck({ name: "Mieszana" }, NOW);
  const payload = {
    format: "fiszki/v1",
    notes: [
      { front: "slowo", back: "word", note_type: "basic_reversed" },
      { front: "To jest pelne zdanie.", back: "This is a full sentence." },
    ],
  };
  const drafts = await draftsFrom("talia.json", JSON.stringify(payload));

  await commitImport(deck.id, drafts, { noteType: "basic", now: NOW });

  const byFront = new Map((await listNotes(deck.id)).map((n) => [n.note.fields.Front, n]));
  expect(byFront.get("slowo")!.cards).toHaveLength(2); // ze zrodla
  expect(byFront.get("To jest pelne zdanie.")!.cards).toHaveLength(1); // z importu
});

it("duplicateSummary widzi to, co juz jest w kolekcji", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await commitImport(deck.id, await draftsFrom("a.csv", "front,back\nkot,cat\n"), {
    noteType: "basic",
    now: NOW,
  });

  const summary = await duplicateSummary(
    await draftsFrom("b.csv", "front,back\nkot,cat\npies,dog\n"),
  );
  expect(summary.alreadyInCollection).toBe(1);
  expect(summary.total).toBe(2);
});

it("import do nieistniejacej talii nie zapisuje niczego", async () => {
  const drafts = await draftsFrom("a.csv", "front,back\nkot,cat\n");
  await expect(
    commitImport("00000000-0000-0000-0000-000000000000", drafts, { noteType: "basic" }),
  ).rejects.toThrow("talii");
  const database = await db();
  expect(await database.getAll("notes")).toHaveLength(0);
});

it("prawdziwa talia OET przechodzi w calosci", async () => {
  // Reprezentatywny wycinek talie/oet-terminologia.json - z przykladem,
  // tagami, kategoria i typem per pozycja.
  const payload = {
    format: "fiszki/v1",
    deck: "OET — terminologia i zwroty formalne",
    default_note_type: "basic_reversed",
    notes: [
      {
        front: "exacerbation",
        back: "zaostrzenie (choroby)",
        example: "Synonimy: acute deterioration / worsening\n\nThe patient was admitted with an acute exacerbation of COPD.",
        tags: ["oet", "terminologia", "raport"],
        kind: "word",
        note_type: "basic_reversed",
        source_ref: "oet-terminy/m1/exacerbation",
      },
      {
        front: "In keeping with",
        back: "Zgodnie z… / Sugerujący",
        tags: ["oet", "terminologia", "raport"],
        kind: "expression",
        note_type: "basic_reversed",
        source_ref: "oet-terminy/m9/in-keeping-with",
      },
    ],
  };
  const deck = await createDeck({ name: "OET" }, NOW);
  const result = parseSource("oet-terminologia.json", utf8(JSON.stringify(payload)));
  expect(result.sourceDecks).toEqual(["OET — terminologia i zwroty formalne"]);

  const drafts = await normalize(result, result.suggestedMapping);
  const stats = await commitImport(deck.id, drafts, { noteType: result.suggestedNoteType, now: NOW });
  expect(stats).toEqual({ imported: 2, skippedDuplicates: 0, skippedInvalid: 0 });

  const notes = await listNotes(deck.id);
  const kinds = new Map(notes.map((n) => [n.note.fields.Front, n.note.itemKind]));
  expect(kinds.get("exacerbation")).toBe("word");
  expect(kinds.get("In keeping with")).toBe("expression");
  expect(notes.every(({ note }) => note.sourceRef?.startsWith("oet-terminy/"))).toBe(true);
});
