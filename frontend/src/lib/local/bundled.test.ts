/**
 * Slownik wbudowany: dostawa tresci z pakietu do Slownika (ADR 0007).
 *
 * Siec udaje mapa url -> tresc, a manifest jest liczony ta sama funkcja,
 * ktora aplikacja sprawdza pobrane pliki - test nie powtarza formatu
 * z pamieci, tylko buduje go tak, jak robi to skrypt przy budowaniu.
 */

import "fake-indexeddb/auto";

import { beforeEach, expect, it } from "vitest";

import {
  BUNDLED_DIR,
  MANIFEST_FORMAT,
  MANIFEST_URL,
  applyBundled,
  bundledState,
  fileHash,
} from "./bundled";
import { closeAndDeleteDb, db } from "./db";
import { parseSource } from "./import";
import { commitImport, normalize } from "./import/service";
import {
  DICTIONARY_DECK_ID,
  deleteNote,
  ensureDictionary,
  listNotes,
  studyQueue,
  submitReview,
  updateNote,
} from "./repo";

const NOW = new Date("2026-09-19T12:00:00");
const LATER = new Date("2026-09-20T12:00:00");

beforeEach(async () => {
  await closeAndDeleteDb();
});

type Site = Record<string, string>;

/** Buduje "hosting": pliki pakietu plus manifest z prawdziwymi odciskami. */
async function site(files: Record<string, unknown[]>): Promise<Site> {
  const pages: Site = {};
  const entries = [];
  for (const [path, notes] of Object.entries(files)) {
    const text = JSON.stringify({ format: "fiszki/v1", notes });
    pages[`${BUNDLED_DIR}/${path}`] = text;
    entries.push({ path, sha256: await fileHash(text), notes: notes.length });
  }
  pages[MANIFEST_URL] = JSON.stringify({ format: MANIFEST_FORMAT, files: entries });
  return pages;
}

function fetchFrom(pages: Site, log: string[] = []): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    log.push(url);
    const body = pages[url];
    return body === undefined
      ? new Response("nie ma", { status: 404 })
      : new Response(body, { status: 200 });
  }) as typeof fetch;
}

const offline: typeof fetch = async () => {
  throw new TypeError("fetch failed");
};

const KOT = { front: "kot", back: "cat", kind: "word", source_ref: "demo/kot" };
const PIES = { front: "pies", back: "dog", kind: "word", source_ref: "demo/pies" };
const RYBA = { front: "ryba", back: "fish", kind: "word", source_ref: "demo/ryba" };

const slownik = () => listNotes(DICTIONARY_DECK_ID);
const fronty = async () => (await slownik()).map((n) => n.note.fields.Front).sort();

it("pierwsze otwarcie wprowadza pakiet do Slownika", async () => {
  const pages = await site({ "a.json": [KOT, PIES] });
  const result = await applyBundled({ now: NOW, fetchFn: fetchFrom(pages) });
  expect(result).toMatchObject({ status: "applied", imported: 2, updated: 0, files: 1, failed: [] });

  const notes = await slownik();
  expect(notes.map((n) => n.note.fields.Front).sort()).toEqual(["kot", "pies"]);
  expect(notes.every((n) => n.cards.length === 2)).toBe(true); // slowa w obie strony

  const state = await bundledState();
  expect(Object.keys(state.files)).toEqual(["a.json"]);
  expect(state.appliedAt).toBe(NOW.toISOString());
});

it("bez zmian w pakiecie pobiera tylko manifest i nic nie zapisuje", async () => {
  const pages = await site({ "a.json": [KOT] });
  await applyBundled({ now: NOW, fetchFn: fetchFrom(pages) });

  const log: string[] = [];
  const again = await applyBundled({ now: LATER, fetchFn: fetchFrom(pages, log) });
  expect(again.status).toBe("up-to-date");
  expect(log).toEqual([MANIFEST_URL]);
  expect((await bundledState()).appliedAt).toBe(NOW.toISOString());
});

it("zmieniony plik wchodzi trybem uzupelnij - stan nauki zostaje", async () => {
  await applyBundled({ now: NOW, fetchFn: fetchFrom(await site({ "a.json": [KOT] })) });
  const karta = (await studyQueue(DICTIONARY_DECK_ID, { now: NOW })).cards[0].card;
  const po = await submitReview({ cardId: karta.id, rating: 3, durationMs: 1500, now: NOW });

  const v2 = await site({ "a.json": [{ ...KOT, example: "The cat sleeps." }, PIES] });
  const result = await applyBundled({ now: LATER, fetchFn: fetchFrom(v2) });
  expect(result).toMatchObject({ status: "applied", imported: 1, updated: 1 });

  const kot = (await slownik()).find((n) => n.note.fields.Front === "kot")!;
  expect(kot.note.fields.Example).toBe("The cat sleeps.");
  expect(kot.cards).toHaveLength(2);
  const nadal = (await (await db()).get("cards", karta.id))!;
  expect(nadal.fsrs.reps).toBe(1);
  expect(nadal.due).toBe(po.card.due);
});

it("poprawka tlumaczenia w pakiecie trafia w te sama fiszke, nie tworzy drugiej", async () => {
  await applyBundled({ now: NOW, fetchFn: fetchFrom(await site({ "a.json": [KOT] })) });
  const przed = (await slownik())[0];

  const v2 = await site({ "a.json": [{ ...KOT, back: "cat (zwierzę)" }] });
  const result = await applyBundled({ now: LATER, fetchFn: fetchFrom(v2) });
  expect(result).toMatchObject({ imported: 0, updated: 1 });

  const notes = await slownik();
  expect(notes).toHaveLength(1);
  expect(notes[0].note.id).toBe(przed.note.id);
  expect(notes[0].note.fields.Back).toBe("cat (zwierzę)");
  expect(notes[0].note.contentHash).not.toBe(przed.note.contentHash);
  // Karty te same - stan nauki idzie dalej z poprawionym tlumaczeniem.
  expect(notes[0].cards.map((c) => c.id).sort()).toEqual(przed.cards.map((c) => c.id).sort());
});

it("fiszki poprawionej recznie pakiet nie nadpisuje - tylko dopisuje braki", async () => {
  await applyBundled({ now: NOW, fetchFn: fetchFrom(await site({ "a.json": [KOT] })) });
  const id = (await slownik())[0].note.id;
  await updateNote(
    id,
    { fields: { Front: "kot", Back: "kot domowy (mój)" }, itemKind: "expression" },
    NOW,
  );

  const v2 = await site({
    "a.json": [{ ...KOT, back: "cat (zwierzę)", example: "The cat sleeps.", kind: "word" }],
  });
  const result = await applyBundled({ now: LATER, fetchFn: fetchFrom(v2) });
  expect(result).toMatchObject({ imported: 0, updated: 1 }); // doszedl przyklad

  const note = (await slownik())[0].note;
  expect(note.fields.Back).toBe("kot domowy (mój)");
  expect(note.itemKind).toBe("expression");
  expect(note.fields.Example).toBe("The cat sleeps.");
});

it("skasowana recznie fiszka nie wraca z pakietem", async () => {
  await applyBundled({ now: NOW, fetchFn: fetchFrom(await site({ "a.json": [KOT, PIES] })) });
  const kot = (await slownik()).find((n) => n.note.fields.Front === "kot")!;
  await deleteNote(kot.note.id);
  expect((await bundledState()).removed).toEqual(
    expect.arrayContaining([kot.note.contentHash, "demo/kot"]),
  );

  // Plik sie zmienil (doszla ryba), wiec wchodzi ponownie - z kotem w srodku.
  const v2 = await site({ "a.json": [KOT, PIES, RYBA] });
  const result = await applyBundled({ now: LATER, fetchFn: fetchFrom(v2) });
  expect(result).toMatchObject({ imported: 1, updated: 0 });
  expect(await fronty()).toEqual(["pies", "ryba"]);
});

it("material wgrany wczesniej recznie nie dubluje sie z pakietem", async () => {
  // Dokladnie sytuacja uzytkownika: ten sam plik najpierw przez ekran Import.
  const deck = await ensureDictionary(NOW);
  const text = JSON.stringify({ format: "fiszki/v1", notes: [KOT, PIES] });
  const parsed = parseSource("reczny.json", new TextEncoder().encode(text));
  await commitImport(deck.id, await normalize(parsed, parsed.suggestedMapping), {
    noteType: "basic_reversed",
    now: NOW,
  });

  const result = await applyBundled({
    now: LATER,
    fetchFn: fetchFrom(await site({ "a.json": [KOT, PIES] })),
  });
  expect(result).toMatchObject({ status: "applied", imported: 0, updated: 0, files: 1 });
  expect(await slownik()).toHaveLength(2);
});

it("plik z niezgodnym odciskiem jest pomijany i zostaje do wprowadzenia", async () => {
  const pages = await site({ "a.json": [KOT] });
  const manifest = JSON.parse(pages[MANIFEST_URL]) as { files: { sha256: string }[] };
  manifest.files[0].sha256 = "0".repeat(64);
  pages[MANIFEST_URL] = JSON.stringify(manifest);

  const result = await applyBundled({ now: NOW, fetchFn: fetchFrom(pages) });
  expect(result.status).toBe("error");
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0]).toContain("a.json");
  expect(await (await db()).count("notes")).toBe(0);
  expect((await bundledState()).files).toEqual({});
});

it("bez sieci konczy sie po cichu i niczego nie zmienia", async () => {
  const result = await applyBundled({ now: NOW, fetchFn: offline });
  expect(result.status).toBe("offline");
  expect(await (await db()).count("notes")).toBe(0);
  expect((await bundledState()).appliedAt).toBeNull();
});

it("uszkodzony manifest to blad, nie cisza", async () => {
  const pages: Site = { [MANIFEST_URL]: JSON.stringify({ format: "cos-innego", files: [] }) };
  const result = await applyBundled({ now: NOW, fetchFn: fetchFrom(pages) });
  expect(result.status).toBe("error");
  expect(result.message).toContain("format");
});

it("manifest nie moze wyslac aplikacji poza katalog pakietu", async () => {
  const pages: Site = {
    [MANIFEST_URL]: JSON.stringify({
      format: MANIFEST_FORMAT,
      files: [{ path: "../sw.js", sha256: "x", notes: 0 }],
    }),
  };
  const result = await applyBundled({ now: NOW, fetchFn: fetchFrom(pages) });
  expect(result.status).toBe("error");
});

it("plik usuniety z pakietu przestaje byc sledzony, jego fiszki zostaja", async () => {
  await applyBundled({
    now: NOW,
    fetchFn: fetchFrom(await site({ "a.json": [KOT], "b.json": [PIES] })),
  });
  const v2 = await site({ "a.json": [KOT, RYBA] });
  const result = await applyBundled({ now: LATER, fetchFn: fetchFrom(v2) });
  expect(result).toMatchObject({ status: "applied", imported: 1 });
  expect(Object.keys((await bundledState()).files)).toEqual(["a.json"]);
  expect(await fronty()).toEqual(["kot", "pies", "ryba"]);
});
