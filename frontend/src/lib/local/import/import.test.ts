/**
 * Testy importerow - port kluczowych przypadkow z backend/tests/test_importers.py.
 * Parsery sa czystymi funkcjami, bez bazy.
 */

import { describe, expect, it } from "vitest";

import { FIELD_BACK, FIELD_EXAMPLE, FIELD_FRONT } from "../content";
import {
  ImportParseError,
  TARGET_IGNORE,
  TARGET_TAGS,
  capWarnings,
  detectFormat,
  parseSource,
} from "./index";
import { parse as parseTabular } from "./tabular";
import { normalize } from "./service";

const utf8 = (text: string) => new TextEncoder().encode(text);

// "przód;tył\nzażółć;gęślą" w cp1250 - recznie, bo TextEncoder zna tylko UTF-8.
// Bajt 0xF3 po ktorym idzie ASCII jest nieprawidlowym UTF-8, wiec sciezka
// fallbacku na windows-1250 naprawde sie wykonuje.
const CP1250_SAMPLE = new Uint8Array([
  0x70, 0x72, 0x7a, 0xf3, 0x64, 0x3b, 0x74, 0x79, 0xb3, 0x0a, // przód;tył
  0x7a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6, 0x3b, 0x67, 0xea, 0x9c, 0x6c, 0xb9, // zażółć;gęślą
]);

// --- CSV -------------------------------------------------------------------

it("csv z polskimi naglowkami mapuje sie sam", () => {
  const result = parseSource("talia.csv", utf8("przód;tył;tagi\nkot;cat;zwierzeta\npies;dog;zwierzeta\n"));
  expect(result.sourceFormat).toBe("csv");
  expect(result.columns).toEqual(["przód", "tył", "tagi"]);
  expect(result.suggestedMapping).toEqual({
    "przód": FIELD_FRONT,
    "tył": FIELD_BACK,
    tagi: TARGET_TAGS,
  });
  expect(result.rows).toHaveLength(2);
});

it("csv z angielskimi naglowkami i kolumna przykladu", () => {
  const result = parseSource("quizlet.csv", utf8("Term,Definition,Example\nubiquitous,wszechobecny,It is ubiquitous.\n"));
  expect(result.suggestedMapping).toEqual({
    Term: FIELD_FRONT,
    Definition: FIELD_BACK,
    Example: FIELD_EXAMPLE,
  });
});

it("csv bez naglowka dostaje kolumny pozycyjne", () => {
  const result = parseSource("bez-naglowka.csv", utf8("kot;cat\npies;dog\nryba;fish\n"));
  expect(result.columns).toEqual(["kolumna 1", "kolumna 2"]);
  expect(result.suggestedMapping["kolumna 1"]).toBe(FIELD_FRONT);
  expect(result.suggestedMapping["kolumna 2"]).toBe(FIELD_BACK);
  expect(result.rows).toHaveLength(3);
  expect(result.warnings.some((w) => w.includes("naglowka"))).toBe(true);
});

it("wykrycie naglowka mozna nadpisac w obie strony", () => {
  const data = utf8("kot;cat\npies;dog\n");
  const forced = parseTabular(data, { hasHeader: true });
  expect(forced.columns).toEqual(["kot", "cat"]);
  expect(forced.rows).toHaveLength(1);

  const rejected = parseTabular(data, { hasHeader: false });
  expect(rejected.columns).toEqual(["kolumna 1", "kolumna 2"]);
  expect(rejected.rows).toHaveLength(2);
});

it("decyzja o naglowku jest zawsze raportowana", () => {
  const withHeader = parseSource("a.csv", utf8("front,back\nkot,cat\n"));
  expect(withHeader.warnings.some((w) => w.includes("naglowek"))).toBe(true);

  const withoutHeader = parseSource("b.csv", utf8("kot;cat\npies;dog\n"));
  expect(withoutHeader.warnings.some((w) => w.includes("naglowka"))).toBe(true);
});

it("tsv dziala", () => {
  const result = parseSource("dane.tsv", utf8("front\tback\nkot\tcat\n"));
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].values.front).toBe("kot");
});

it("plik w cp1250 jest dekodowany", () => {
  const result = parseSource("windows.csv", CP1250_SAMPLE);
  expect(result.columns).toEqual(["przód", "tył"]);
  expect(result.rows[0].values["przód"]).toBe("zażółć");
  expect(result.rows[0].values["tył"]).toBe("gęślą");
});

it("nadmiarowe kolumny sa domyslnie pomijane", () => {
  const result = parseSource("szeroki.csv", utf8("front,back,notes,zrodlo\nkot,cat,x,y\n"));
  const targets = Object.values(result.suggestedMapping);
  expect(targets.filter((t) => t === TARGET_IGNORE)).toHaveLength(2);
});

it("cudzyslowy chronia separator wewnatrz pola", () => {
  const result = parseSource("q.csv", utf8('front;back\n"a, b; c";x\n'));
  expect(result.rows[0].values.front).toBe("a, b; c");
  expect(result.rows[0].values.back).toBe("x");
});

it("pusty plik jest odrzucany", () => {
  expect(() => parseSource("pusty.csv", utf8("   \n  \n"))).toThrow(ImportParseError);
});

// --- czyszczenie HTML ------------------------------------------------------

it("komorki z html sa sprowadzane do tekstu", () => {
  const data = utf8(
    "front\tback\n" +
      "to chase up<br><span style='color:#888'>/tʃeɪz ʌp/</span>\t" +
      "<div style='border:2px solid'>ponaglić</div><div>📖 to follow up on</div>\n",
  );
  const result = parseSource("tracker.tsv", data);
  expect(result.rows[0].values.front).toBe("to chase up\n/tʃeɪz ʌp/");
  // Emoji zostaje: to tresc, nie znacznik.
  expect(result.rows[0].values.back).toBe("ponaglić\n📖 to follow up on");
  expect(result.warnings.some((w) => w.includes("HTML"))).toBe(true);
});

it("ostre nawiasy bez znacznika przezywaja", () => {
  const result = parseSource("matma.csv", utf8("front,back\na < b,mniejsze niz\n"));
  expect(result.rows[0].values.front).toBe("a < b");
  expect(result.warnings.some((w) => w.includes("HTML"))).toBe(false);
});

it("encje html sa rozwiazywane", () => {
  const result = parseSource("dane.csv", utf8("front,back\n<b>R&amp;D</b>,badania i rozwój\n"));
  expect(result.rows[0].values.front).toBe("R&D");
});

it("wersja z html i bez daje ten sam odcisk tresci", async () => {
  const withHtml = parseSource("a.csv", utf8("front,back\n<b>kot</b>,cat\n"));
  const plain = parseSource("b.csv", utf8("front,back\nkot,cat\n"));
  const left = await normalize(withHtml, withHtml.suggestedMapping);
  const right = await normalize(plain, plain.suggestedMapping);
  expect(left[0].contentHash).toBe(right[0].contentHash);
});

// --- zwykly tekst ----------------------------------------------------------

it("tekst z myslnikiem i komentarzami", () => {
  const result = parseSource("lista.txt", utf8("kot - cat\npies - dog\n# komentarz\nryba - fish\n"));
  expect(result.sourceFormat).toBe("text");
  expect(result.rows).toHaveLength(3);
  expect(result.rows[0].values).toEqual({ przod: "kot", tyl: "cat" });
});

it("myslnik bez spacji jest czescia slowa, nie separatorem", () => {
  const result = parseSource("lista.txt", utf8("well-known - dobrze znany\n"));
  expect(result.rows[0].values.przod).toBe("well-known");
});

it("tekst bez separatora jest odrzucany", () => {
  expect(() =>
    parseSource("lista.txt", utf8("sama tresc bez separatora\ndruga linia\n")),
  ).toThrow(ImportParseError);
});

// --- format kanoniczny -----------------------------------------------------

const ENVELOPE = {
  format: "fiszki/v1",
  deck: "Angielski B2",
  default_note_type: "basic_reversed",
  notes: [
    {
      front: "ubiquitous",
      back: "wszechobecny",
      example: "Smartphones are ubiquitous.",
      tags: ["b2", "przymiotnik"],
      kind: "word",
      source_ref: "oxford/ubiquitous",
    },
    { front: "kick the bucket", back: "kopnąć w kalendarz", kind: "expression" },
  ],
};

it("fiszki/v1 nie wymaga mapowania", async () => {
  const result = parseSource("talia.json", utf8(JSON.stringify(ENVELOPE)));
  expect(result.sourceFormat).toBe("fiszki-json");
  expect(result.suggestedNoteType).toBe("basic_reversed");
  expect(result.sourceDecks).toEqual(["Angielski B2"]);
  expect(Object.entries(result.suggestedMapping).every(([k, v]) => k === v)).toBe(true);

  const drafts = await normalize(result, result.suggestedMapping);
  expect(drafts).toHaveLength(2);
  expect(drafts[0].fields[FIELD_EXAMPLE]).toBe("Smartphones are ubiquitous.");
  expect(drafts[0].tags).toEqual(["b2", "przymiotnik"]);
  expect(drafts[0].itemKind).toBe("word");
  expect(drafts[0].sourceRef).toBe("oxford/ubiquitous");
  // EXPRESSION nie jest zgadywane - musi pochodzic wprost ze zrodla.
  expect(drafts[1].itemKind).toBe("expression");
});

it("naga lista notatek jest przyjmowana z ostrzezeniem", () => {
  const result = parseSource("lista.json", utf8(JSON.stringify([{ front: "kot", back: "cat" }])));
  expect(result.rows).toHaveLength(1);
  expect(result.warnings.some((w) => w.includes("koperty"))).toBe(true);
});

it("note_type per pozycja jest czytany, nieznany wraca do typu z importu", () => {
  const payload = {
    format: "fiszki/v1",
    notes: [
      { front: "a", back: "x", note_type: "basic_reversed" },
      { front: "b", back: "y", note_type: "basic" },
      { front: "c", back: "z" },
      { front: "d", back: "w", note_type: "trojstronna" },
    ],
  };
  const result = parseSource("talia.json", utf8(JSON.stringify(payload)));
  expect(result.rows.map((r) => r.noteType)).toEqual(["basic_reversed", "basic", null, null]);
  expect(result.warnings.some((w) => w.includes("trojstronna"))).toBe(true);
});

it("brak listy notes to blad, wadliwe pozycje sa pomijane z ostrzezeniem", () => {
  expect(() => parseSource("z.json", utf8('{"format":"fiszki/v1"}'))).toThrow("notes");

  const result = parseSource(
    "t.json",
    utf8(JSON.stringify({ notes: [{ front: "kot", back: "cat" }, { front: "", back: "x" }, 42] })),
  );
  expect(result.rows).toHaveLength(1);
  expect(result.warnings.some((w) => w.includes("Pozycja 2"))).toBe(true);
  expect(result.warnings.some((w) => w.includes("Pozycja 3"))).toBe(true);
});

// --- normalize -------------------------------------------------------------

it("normalize odrzuca wiersze bez obu stron", async () => {
  const result = parseSource("dane.csv", utf8("front,back\nkot,cat\n,samo tyl\nsam przod,\n"));
  const drafts = await normalize(result, result.suggestedMapping);
  expect(drafts).toHaveLength(1);
});

it("jawna kategoria wygrywa z heurystyka, kolumna zrodla ze wszystkim", async () => {
  const guessed = await normalize(
    parseSource("a.csv", utf8("front,back\nkot,cat\n")),
    { front: FIELD_FRONT, back: FIELD_BACK },
  );
  expect(guessed[0].itemKind).toBe("word");

  const forced = await normalize(
    parseSource("b.csv", utf8("front,back\nkot,cat\n")),
    { front: FIELD_FRONT, back: FIELD_BACK },
    "expression",
  );
  expect(forced[0].itemKind).toBe("expression");

  const fromColumn = await normalize(
    parseSource("c.csv", utf8("front,back,rodzaj\nkot,cat,zdanie\n")),
    { front: FIELD_FRONT, back: FIELD_BACK, rodzaj: "kind" },
    "word",
  );
  expect(fromColumn[0].itemKind).toBe("sentence");
});

it("tagi sa dzielone po przecinku i sredniku, unikalne i posortowane", async () => {
  const result = parseSource("dane.tsv", utf8("front\tback\ttags\nkot\tcat\tzwierzeta; domowe, ssaki, domowe\n"));
  const drafts = await normalize(result, result.suggestedMapping);
  expect(drafts[0].tags).toEqual(["domowe", "ssaki", "zwierzeta"]);
});

// --- limit ostrzezen -------------------------------------------------------

it("capWarnings zostawia krotka liste w spokoju i ucina dluga", () => {
  const short = ["a", "b"];
  expect(capWarnings(short)).toEqual(short);

  const long = Array.from({ length: 120 }, (_, i) => `ostrzezenie ${i}`);
  const capped = capWarnings(long);
  expect(capped).toHaveLength(51);
  expect(capped[50]).toContain("70");
});

it("plik z setkami wadliwych pozycji nie rozdyma ostrzezen", () => {
  const notes = Array.from({ length: 500 }, () => ({ front: "", back: "" }));
  notes.push({ front: "kot", back: "cat" });
  const result = parseSource("talia.json", utf8(JSON.stringify({ notes })));
  expect(result.rows).toHaveLength(1);
  expect(result.warnings.length).toBeLessThanOrEqual(51);
});

// --- wykrywanie formatu ----------------------------------------------------

describe("wykrywanie formatu", () => {
  it("zawartosc json wygrywa z rozszerzeniem .txt", () => {
    expect(detectFormat("cokolwiek.txt", utf8('  {"notes": []}')).key).toBe("fiszki-json");
  });

  it("plik anki dostaje jasna odmowe z instrukcja", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(() => detectFormat("talia.apkg", zip)).toThrow(/Anki/);
  });

  it("rozszerzenie decyduje, gdy zawartosc nie rozstrzyga", () => {
    expect(detectFormat("dane.csv", utf8("kot;cat\n")).key).toBe("csv");
    expect(detectFormat("lista.txt", utf8("kot - cat\n")).key).toBe("text");
  });

  it("bez rozszerzenia decyduje gestosc separatorow", () => {
    expect(detectFormat("schowek", utf8("a;b;c\nd;e;f\n")).key).toBe("csv");
    expect(detectFormat("schowek", utf8("kot - cat\npies - dog\n")).key).toBe("text");
  });
});
