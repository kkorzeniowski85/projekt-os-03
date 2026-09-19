/** Testy zapisu importu do IndexedDB (fake-indexeddb). */

import "fake-indexeddb/auto";

import { beforeEach, expect, it } from "vitest";

import { closeAndDeleteDb, db } from "../db";
import { createDeck, listNotes, studyQueue, submitReview } from "../repo";
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
  expect(first).toEqual({ imported: 2, updated: 0, skippedDuplicates: 0, skippedInvalid: 0 });

  const listed = await listNotes(deck.id);
  expect(listed).toHaveLength(2);
  const ubiquitous = listed.map((n) => n.note).find((n) => n.fields.Front === "ubiquitous")!;
  expect(ubiquitous.fields.Example).toBe("It is ubiquitous.");
  expect(ubiquitous.itemKind).toBe("word");
  expect(listed.every(({ cards }) => cards.length === 2)).toBe(true);

  // Deduplikacja po tresci: ten sam plik drugi raz nie tworzy niczego.
  const again = await commitImport(deck.id, drafts, { noteType: "basic_reversed", now: NOW });
  expect(again).toEqual({ imported: 0, updated: 0, skippedDuplicates: 2, skippedInvalid: 0 });
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
  expect(stats).toEqual({ imported: 2, updated: 0, skippedDuplicates: 0, skippedInvalid: 0 });

  const notes = await listNotes(deck.id);
  const kinds = new Map(notes.map((n) => [n.note.fields.Front, n.note.itemKind]));
  expect(kinds.get("exacerbation")).toBe("word");
  expect(kinds.get("In keeping with")).toBe("expression");
  expect(notes.every(({ note }) => note.sourceRef?.startsWith("oet-terminy/"))).toBe(true);
});

it("import zachowuje kolejnosc fiszek z pliku", async () => {
  // Autor talii uklada ja w przemyslanej kolejnosci - nauka ma isc tak samo,
  // a nie w porzadku wyznaczonym przez baze.
  const deck = await createDeck({ name: "Kolejnosc" }, NOW);
  const kolejnosc = ["pierwsza", "druga", "trzecia", "czwarta", "piata"];
  const drafts = await draftsFrom(
    "talia.json",
    JSON.stringify({ format: "fiszki/v1", notes: kolejnosc.map((f) => ({ front: f, back: "x" })) }),
  );

  await commitImport(deck.id, drafts, { noteType: "basic", now: NOW });

  const queue = await studyQueue(deck.id, { now: NOW, limit: 10 });
  expect(queue.cards.map((e) => e.note.fields.Front)).toEqual(kolejnosc);
});

// --- aktualizacja istniejacych ---------------------------------------------
//
// Ponowny import wzbogaconego pliku ma uzupelniac to, co juz jest, zamiast
// odbijac sie od deduplikacji. Zasada: uzupelnia, nigdy nie zubaza i nigdy
// nie rusza stanu nauki.

it("tryb update dopisuje przyklad do istniejacej fiszki", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await commitImport(deck.id, await draftsFrom("a.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "to rule out", back: "wykluczyć" }],
  })), { noteType: "basic", now: NOW });

  const wzbogacony = await draftsFrom("b.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "to rule out", back: "wykluczyć", example: "Rule out a bleed first." }],
  }));

  // Domyslnie (skip) nic sie nie dzieje - to dotychczasowe zachowanie.
  const pominiete = await commitImport(deck.id, wzbogacony, { noteType: "basic", now: NOW });
  expect(pominiete).toEqual({ imported: 0, updated: 0, skippedDuplicates: 1, skippedInvalid: 0 });
  expect((await listNotes(deck.id))[0].note.fields.Example).toBeUndefined();

  const zaktualizowane = await commitImport(deck.id, wzbogacony, {
    noteType: "basic",
    onDuplicate: "update",
    now: NOW,
  });
  expect(zaktualizowane).toEqual({ imported: 0, updated: 1, skippedDuplicates: 0, skippedInvalid: 0 });

  const notes = await listNotes(deck.id);
  expect(notes).toHaveLength(1); // nie powstala druga fiszka
  expect(notes[0].note.fields.Example).toBe("Rule out a bleed first.");
});

it("aktualizacja nie rusza stanu nauki", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await commitImport(deck.id, await draftsFrom("a.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "obs", back: "parametry" }],
  })), { noteType: "basic", now: NOW });

  const karta = (await studyQueue(deck.id, { now: NOW })).cards[0].card;
  const po = await submitReview({ cardId: karta.id, rating: 4, durationMs: 2000, now: NOW });

  await commitImport(deck.id, await draftsFrom("b.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "obs", back: "parametry", example: "Keep an eye on his obs." }],
  })), { noteType: "basic", onDuplicate: "update", now: NOW });

  const database = await db();
  const nadal = (await database.get("cards", karta.id))!;
  expect(nadal.fsrs.reps).toBe(1);
  expect(nadal.fsrs.state).toBe(po.card.fsrs.state);
  expect(nadal.due).toBe(po.card.due);
  // Historia tez nietknieta.
  expect(await database.count("reviewLog")).toBe(1);
});

it("aktualizacja uzupelnia, ale nigdy nie zubaza", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await commitImport(deck.id, await draftsFrom("a.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "kot", back: "cat", example: "The cat is asleep.", tags: ["zwierzeta"] }],
  })), { noteType: "basic", now: NOW });

  // Ubozsza wersja: bez przykladu, z innym tagiem.
  await commitImport(deck.id, await draftsFrom("b.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "kot", back: "cat", tags: ["domowe"] }],
  })), { noteType: "basic", onDuplicate: "update", now: NOW });

  const note = (await listNotes(deck.id))[0].note;
  expect(note.fields.Example).toBe("The cat is asleep."); // przyklad przezyl
  expect(note.tags).toEqual(["domowe", "zwierzeta"]); // tagi sie zsumowaly
});

it("zgadnieta kategoria nie nadpisuje recznie ustawionej", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  // Zrodlo podaje wprost "expression".
  await commitImport(deck.id, await draftsFrom("a.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "kick the bucket", back: "kopnąć w kalendarz", kind: "expression" }],
  })), { noteType: "basic", now: NOW });
  expect((await listNotes(deck.id))[0].note.itemKind).toBe("expression");

  // Ten sam material bez kategorii - heurystyka zgadnie "phrase".
  const bezKategorii = await draftsFrom("b.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "kick the bucket", back: "kopnąć w kalendarz", example: "He kicked the bucket." }],
  }));
  expect(bezKategorii[0].itemKind).toBe("phrase");
  expect(bezKategorii[0].kindExplicit).toBe(false);

  await commitImport(deck.id, bezKategorii, { noteType: "basic", onDuplicate: "update", now: NOW });

  const note = (await listNotes(deck.id))[0].note;
  expect(note.itemKind).toBe("expression"); // kategoria obroniona
  expect(note.fields.Example).toBe("He kicked the bucket."); // reszta uzupelniona
});

it("jawna kategoria ze zrodla nadpisuje poprzednia", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await commitImport(deck.id, await draftsFrom("a.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "to chase up", back: "ponaglić", kind: "phrase" }],
  })), { noteType: "basic", now: NOW });

  await commitImport(deck.id, await draftsFrom("b.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "to chase up", back: "ponaglić", kind: "expression" }],
  })), { noteType: "basic", onDuplicate: "update", now: NOW });

  expect((await listNotes(deck.id))[0].note.itemKind).toBe("expression");
});

it("aktualizacja nie zmienia liczby kart", async () => {
  // Zmiana typu = skasowanie karty razem ze stanem FSRS. Aktualizacja
  // dotyczy tresci, nie struktury - typ zmienia sie swiadomie przez "Edytuj".
  const deck = await createDeck({ name: "Talia" }, NOW);
  await commitImport(deck.id, await draftsFrom("a.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "kot", back: "cat", note_type: "basic_reversed" }],
  })), { noteType: "basic", now: NOW });
  expect((await listNotes(deck.id))[0].cards).toHaveLength(2);

  await commitImport(deck.id, await draftsFrom("b.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "kot", back: "cat", note_type: "basic", example: "Nowy przykład." }],
  })), { noteType: "basic", onDuplicate: "update", now: NOW });

  const listed = (await listNotes(deck.id))[0];
  expect(listed.cards).toHaveLength(2); // typ bez zmian
  expect(listed.note.fields.Example).toBe("Nowy przykład."); // tresc uzupelniona
});

it("brak zmian nie liczy sie jako aktualizacja", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const drafts = await draftsFrom("a.json", JSON.stringify({
    format: "fiszki/v1",
    notes: [{ front: "kot", back: "cat", example: "The cat." }],
  }));
  await commitImport(deck.id, drafts, { noteType: "basic", now: NOW });

  const bezZmian = await commitImport(deck.id, drafts, {
    noteType: "basic",
    onDuplicate: "update",
    now: NOW,
  });
  expect(bezZmian).toEqual({ imported: 0, updated: 0, skippedDuplicates: 1, skippedInvalid: 0 });
});

it("tryb add nadal tworzy osobna fiszke", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const drafts = await draftsFrom("a.csv", "front,back\nkot,cat\n");
  await commitImport(deck.id, drafts, { noteType: "basic", now: NOW });
  await commitImport(deck.id, drafts, { noteType: "basic", onDuplicate: "add", now: NOW });
  expect(await listNotes(deck.id)).toHaveLength(2);
});
