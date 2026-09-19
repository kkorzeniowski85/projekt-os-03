/**
 * Pola adnotacji (wymowa, synonimy, odpowiednik formalny) i karta opisowa.
 *
 * Najwazniejszy test tego pliku to ten na calym pakiecie: rozbior dziala na
 * PRAWDZIWYM materiale uzytkownika, nie na wymyslonych probkach.
 */

import "fake-indexeddb/auto";

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { FIELD_FORMAL, FIELD_SYNONYMS, contentHash } from "./content";
import { closeAndDeleteDb, db } from "./db";
import { splitLegacyExample } from "./legacy-example";
import { cueOf, exampleOf, renderCard, templateLabel } from "./render";
import {
  CUE_TEMPLATE_ORD,
  createDeck,
  createNote,
  cueUsable,
  listNotes,
  naprawPrzyklady,
  setCueCard,
  studyQueue,
  submitReview,
  updateNote,
} from "./repo";
import type { NoteRecord } from "./types";

const NOW = new Date("2026-09-19T12:00:00");

beforeEach(async () => {
  await closeAndDeleteDb();
});

const SKLEJONY =
  "/tə tʃeɪz ʌp/\nFormalnie (OET): to follow up on\n\nI'll chase up the agent tomorrow.";

const nota = (fields: Record<string, string>) =>
  ({ id: "x", fields, tags: [], noteType: "basic" }) as unknown as NoteRecord;

// --- odcisk tresci ---------------------------------------------------------

it("nowe pola NIE zmieniaja odcisku tresci", async () => {
  // Gdyby weszly do odcisku, jedno uzupelnienie pakietu zamieniloby sie
  // z 229 aktualizacji w 229 duplikatow.
  const goly = { Front: "to chase up", Back: "ponaglić" };
  const zAdnotacjami = {
    ...goly,
    Example: "I'll chase up the agent.",
    Pronunciation: "/tə tʃeɪz ʌp/",
    Synonyms: "to follow up",
    Formal: "to follow up on",
  };
  expect(await contentHash(zAdnotacjami)).toBe(await contentHash(goly));
});

// --- rozbior w locie -------------------------------------------------------

it("ekran nauki jest poprawny takze bez naprawy danych", () => {
  // Rozbior przy odczycie: notatka ze sklejonym przykladem pokazuje sie tak
  // samo jak naprawiona. Naprawa jest porzadkiem, nie warunkiem poprawnosci.
  const sklejona = nota({ Front: "to chase up", Back: "ponaglić", Example: SKLEJONY });
  expect(exampleOf(sklejona)).toBe("I'll chase up the agent tomorrow.");
  expect(renderCard(sklejona, 0).answer).toBe("ponaglić");
});

it("wskazowka karty opisowej to synonimy, NIGDY odpowiednik formalny", () => {
  // "to follow up on" jako pytanie z odpowiedzia "to chase up" cwiczyloby
  // produkcje kolokwializmu - tego, za co OET Writing obniza ocene.
  const zFormalnym = nota({ Front: "to chase up", Back: "ponaglić", [FIELD_FORMAL]: "to follow up on" });
  expect(cueOf(zFormalnym)).toBe("");

  const zSynonimami = nota({ Front: "pyrexia", Back: "gorączka", [FIELD_SYNONYMS]: "fever / high temperature" });
  expect(cueOf(zSynonimami)).toBe("fever / high temperature");
  expect(renderCard(zSynonimami, 2)).toEqual({
    question: "fever / high temperature",
    answer: "pyrexia",
  });
});

it("karta opisowa bez wskazowki nie pokazuje pustego ekranu", () => {
  const bezSynonimow = nota({ Front: "kot", Back: "cat" });
  expect(renderCard(bezSynonimow, 2)).toEqual({ question: "kot", answer: "cat" });
  expect(templateLabel(2)).toBe("opis → termin");
});

// --- naprawa danych --------------------------------------------------------

describe("naprawa sklejonych przykladow", () => {
  async function zeSklejonym() {
    const deck = await createDeck({ name: "Talia" }, NOW);
    const { note, cards } = await createNote(
      {
        deckId: deck.id,
        noteType: "basic_reversed",
        fields: { Front: "to chase up", Back: "ponaglić", Example: SKLEJONY },
      },
      NOW,
    );
    return { deck, note, cards };
  }

  it("przenosi adnotacje do wlasnych pol, nie ruszajac reszty", async () => {
    const { deck, note } = await zeSklejonym();
    expect(await naprawPrzyklady()).toBe(1);

    const po = (await listNotes(deck.id))[0].note;
    expect(po.fields.Example).toBe("I'll chase up the agent tomorrow.");
    expect(po.fields.Pronunciation).toBe("/tə tʃeɪz ʌp/");
    expect(po.fields.Formal).toBe("to follow up on");
    // Nietkniete: odcisk, slad reki uzytkownika, liczba kart.
    expect(po.contentHash).toBe(note.contentHash);
    expect(po.editedAt).toBe(note.editedAt);
    expect((await listNotes(deck.id))[0].cards).toHaveLength(2);
  });

  it("drugi przebieg nic juz nie zmienia", async () => {
    await zeSklejonym();
    expect(await naprawPrzyklady()).toBe(1);
    expect(await naprawPrzyklady()).toBe(0);
  });

  it("nie rusza stanu nauki", async () => {
    const { deck, cards } = await zeSklejonym();
    const po = await submitReview({ cardId: cards[0].id, rating: 3, durationMs: 900, now: NOW });
    await naprawPrzyklady();
    const teraz = (await (await db()).get("cards", cards[0].id))!;
    expect(teraz.fsrs.reps).toBe(1);
    expect(teraz.due).toBe(po.card.due);
    void deck;
  });

  it("zapisuje pola w kolejnosci KNOWN_FIELDS", async () => {
    // Kolejnosc kluczy wchodzi do porownan JSON.stringify - przetasowanie
    // dawaloby falszywe "zaktualizowano" przy kazdym imporcie.
    const { deck } = await zeSklejonym();
    await naprawPrzyklady();
    const klucze = Object.keys((await listNotes(deck.id))[0].note.fields);
    expect(klucze).toEqual(["Front", "Back", "Example", "Pronunciation", "Formal"]);
  });
});

// --- karta opisowa w bazie -------------------------------------------------

describe("karta opisowa", () => {
  async function zSynonimami() {
    const deck = await createDeck({ name: "Talia" }, NOW);
    const { note } = await createNote(
      {
        deckId: deck.id,
        noteType: "basic_reversed",
        fields: { Front: "pyrexia", Back: "gorączka", Synonyms: "fever / high temperature" },
      },
      NOW,
    );
    return { deck, note };
  }

  it("powstaje obok dwoch istniejacych i nie rusza ich", async () => {
    const { deck, note } = await zSynonimami();
    expect(await setCueCard(note.id, true, NOW)).toBe(true);

    const karty = (await listNotes(deck.id))[0].cards;
    expect(karty.map((c) => c.templateOrd).sort()).toEqual([0, 1, 2]);
    // Ponowne wlaczenie nic nie zmienia.
    expect(await setCueCard(note.id, true, NOW)).toBe(false);
  });

  it("wylaczenie ODKLADA karte, nie kasuje jej stanu nauki", async () => {
    const { deck, note } = await zSynonimami();
    await setCueCard(note.id, true, NOW);
    const opisowa = (await listNotes(deck.id))[0].cards.find((c) => c.templateOrd === 2)!;
    await submitReview({ cardId: opisowa.id, rating: 3, durationMs: 800, now: NOW });

    await setCueCard(note.id, false, NOW);
    const po = (await (await db()).get("cards", opisowa.id))!;
    expect(po.suspended).toBe(true);
    expect(po.fsrs.reps).toBe(1); // historia nietknieta

    await setCueCard(note.id, true, NOW);
    expect((await (await db()).get("cards", opisowa.id))!.suspended).toBeUndefined();
  });

  it("edycja fiszki NIE kasuje karty opisowej", async () => {
    // Petla uzgadniajaca liczbe kart dziala po indeksie: bez wylaczenia ord 2
    // z jej zasiegu kasowalaby karte opisowa przy kazdym zapisie formularza.
    const { deck, note } = await zSynonimami();
    await setCueCard(note.id, true, NOW);
    await updateNote(note.id, { fields: { Front: "pyrexia", Back: "gorączka (formalnie)" } }, NOW);
    expect((await listNotes(deck.id))[0].cards.map((c) => c.templateOrd).sort()).toEqual([0, 1, 2]);
  });

  it("zmiana typu na jednostronny nie rusza karty opisowej", async () => {
    const { deck, note } = await zSynonimami();
    await setCueCard(note.id, true, NOW);
    await updateNote(note.id, { noteType: "basic" }, NOW);
    expect((await listNotes(deck.id))[0].cards.map((c) => c.templateOrd).sort()).toEqual([0, 2]);
  });

  it("nie zasiewa karty, ktorej wskazowka zdradza odpowiedz", () => {
    expect(cueUsable(nota({ Front: "follow-up", Back: "kontrola", Synonyms: "follow-up visit" }))).toBe(
      false,
    );
    expect(cueUsable(nota({ Front: "pyrexia", Back: "gorączka", Synonyms: "fever" }))).toBe(true);
    expect(cueUsable(nota({ Front: "kot", Back: "cat" }))).toBe(false);
  });

  it("trzy karty nadal daja jedna fiszke na sesje", async () => {
    const { deck, note } = await zSynonimami();
    await setCueCard(note.id, true, NOW);
    const queue = await studyQueue(deck.id, { now: NOW });
    expect(queue.cards).toHaveLength(1);
  });

  it("ocena zapisuje kierunek karty w logu", async () => {
    const { deck, note } = await zSynonimami();
    await setCueCard(note.id, true, NOW);
    const opisowa = (await listNotes(deck.id))[0].cards.find((c) => c.templateOrd === 2)!;
    const { log } = await submitReview({
      cardId: opisowa.id,
      rating: 3,
      durationMs: 700,
      now: NOW,
    });
    expect(log.templateOrd).toBe(CUE_TEMPLATE_ORD);
  });
});

// --- prawdziwy pakiet ------------------------------------------------------

const PAKIET = resolve(__dirname, "../../../public/slownik");
const pakietJest = existsSync(PAKIET);

describe.skipIf(!pakietJest)("caly pakiet wbudowany", () => {
  it("rozbiera sie bez reszty - zadna fiszka nie traci zdan", () => {
    let razem = 0;
    let zSynonimami = 0;
    let zFormalnym = 0;
    let zWymowa = 0;
    const bezZdan: string[] = [];
    const zostalNaglowek: string[] = [];

    for (const nazwa of readdirSync(PAKIET)) {
      if (!nazwa.endsWith(".json") || nazwa === "manifest.json") continue;
      const plik = JSON.parse(readFileSync(join(PAKIET, nazwa), "utf8")) as {
        notes: Array<{ front: string; example?: string }>;
      };
      for (const pozycja of plik.notes) {
        razem += 1;
        const podzial = splitLegacyExample(pozycja.example);
        if (podzial.synonyms) zSynonimami += 1;
        if (podzial.formal) zFormalnym += 1;
        if (podzial.pronunciation) zWymowa += 1;
        if (pozycja.example && !podzial.example) bezZdan.push(pozycja.front);
        if (/^(synonimy|formalnie)/im.test(podzial.example)) zostalNaglowek.push(pozycja.front);
      }
    }

    // Niezmienniki, nie konkretne liczby: pakiet ma rosnac bez lamania testu.
    // Pierwsza wersja asertowala 229 i padla przy dolozeniu pliku ze skrotami -
    // test pilnowal wtedy rozmiaru pakietu zamiast poprawnosci rozbioru.
    expect(bezZdan).toEqual([]); // zadne zdanie nie ginie
    expect(zostalNaglowek).toEqual([]); // nic nie zostaje sklejone
    expect(razem).toBeGreaterThanOrEqual(229);
    expect(zSynonimami).toBeGreaterThanOrEqual(143);
    expect(zFormalnym).toBeGreaterThanOrEqual(86);
    expect(zWymowa).toBeGreaterThanOrEqual(86);
  });
});
