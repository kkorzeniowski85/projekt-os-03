/**
 * Wspolny kontrakt importerow - port backend/app/importers/base.py (ADR 0004).
 *
 * Kazdy format sprowadzamy do tej samej postaci posredniej: lista wierszy
 * (kolumna zrodlowa -> wartosc) plus wykryte kolumny. Dopiero mapowanie
 * zamienia to na notatki. Dolozenie formatu = jeden modul z parse().
 */

import type { ItemKind, NoteType } from "@/lib/types";

import { FIELD_BACK, FIELD_EXAMPLE, FIELD_FRONT,
  FIELD_PRONUNCIATION,
  FIELD_SYNONYMS,
  FIELD_FORMAL,
} from "../content";

//: Cele mapowania: pola aplikacji + role specjalne.
export const TARGET_IGNORE = "ignore";
export const TARGET_TAGS = "tags";
export const TARGET_KIND = "kind";
export const MAPPING_TARGETS = [
  FIELD_FRONT,
  FIELD_BACK,
  FIELD_EXAMPLE,
  FIELD_PRONUNCIATION,
  FIELD_SYNONYMS,
  FIELD_FORMAL,
  TARGET_TAGS,
  TARGET_KIND,
  TARGET_IGNORE,
] as const;

export interface SourceRow {
  values: Record<string, string>;
  /** Identyfikator w zrodle - do rozpoznania pozycji przy ponownym imporcie. */
  sourceRef: string | null;
  /** Talia w zrodle (fiszki/v1 moze ja podac). */
  sourceDeck: string | null;
  /** Tagi podane wprost przez zrodlo, poza mapowaniem kolumn. */
  tags: string[];
  /** Typ notatki narzucony przez zrodlo dla tej jednej pozycji. */
  noteType: NoteType | null;
}

export function sourceRow(partial: Partial<SourceRow> & { values: Record<string, string> }): SourceRow {
  return { sourceRef: null, sourceDeck: null, tags: [], noteType: null, ...partial };
}

export interface ParseResult {
  sourceFormat: string;
  columns: string[];
  rows: SourceRow[];
  suggestedMapping: Record<string, string>;
  warnings: string[];
  sourceDecks: string[];
  suggestedNoteType: NoteType;
}

/** Blad, ktory da sie pokazac uzytkownikowi wprost. */
export class ImportParseError extends Error {}

/**
 * Ile ostrzezen ma sens pokazac. Przy imporcie calej kolekcji wadliwych
 * pozycji moga byc tysiace - lista tej dlugosci jest nie do przeczytania.
 */
export const WARNING_LIMIT = 50;

export function capWarnings(warnings: string[], limit = WARNING_LIMIT): string[] {
  if (warnings.length <= limit) return warnings;
  const hidden = warnings.length - limit;
  return [...warnings.slice(0, limit), `…i jeszcze ${hidden} podobnych ostrzezen.`];
}

// --- tekst z HTML ----------------------------------------------------------
//
// Eksporty fiszek czesto niosa HTML (Anki, arkusze, trackery). Ekran nauki
// renderuje tresc doslownie, wiec znacznik zostawiony w polu widac jako smiec
// - i psuje odcisk tresci (ta sama fiszka z HTML-em i bez przestaje byc
// duplikatem).

const SOUND = /\[sound:[^\]]*\]/gi;
const BREAK = /<\s*(br|\/div|\/p|\/li|\/tr)\s*\/?\s*>/gi;
const ANY_TAG = /<[^>]+>/g;

/** Znaczniki, ktore uznajemy za dowod, ze to naprawde HTML. */
const REAL_TAG =
  /<\/?(?:br|div|p|span|b|i|u|em|strong|li|ul|ol|table|tr|td|th|font|a|img|h[1-6]|hr|sub|sup|code|pre|blockquote)\b[^>]*>/i;

/**
 * Czy wartosc ma prawdziwe znaczniki, czy tylko ostre nawiasy. Komorka
 * "a < b" HTML-em nie jest - potraktowana jak HTML stracilaby tresc.
 * Przy watpliwosci nie ruszamy danych.
 */
export function looksLikeHtml(value: string): boolean {
  return REAL_TAG.test(value ?? "");
}

/** Sprowadza pole w HTML do czystego tekstu, zachowujac podzial na linie. */
export function toPlainText(raw: string): string {
  const withoutSound = (raw ?? "").replace(SOUND, "");
  const withNewlines = withoutSound.replace(BREAK, "\n");
  const plain = unescapeEntities(withNewlines.replace(ANY_TAG, ""));
  return plain
    .replace(/\xa0/g, " ") // twarde spacje zafalszowalyby porownania i hashe
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": "\xa0",
};

function unescapeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[m.toLowerCase()] ?? m;
  });
}

// --- sugerowanie mapowania -------------------------------------------------

//: Nazwy kolumn spotykane w praktyce (Quizlet, Anki, arkusze, eksporty kursow).
const HINTS: Record<string, readonly string[]> = {
  [FIELD_FRONT]: [
    "front", "przod", "przód", "term", "termin", "word", "slowo", "słowo",
    "question", "pytanie", "source", "zrodlo", "źródło", "obcy", "foreign",
    "expression", "wyrazenie", "wyrażenie", "haslo", "hasło", "a", "1",
  ],
  [FIELD_BACK]: [
    "back", "tyl", "tył", "definition", "definicja", "answer", "odpowiedz",
    "odpowiedź", "translation", "tlumaczenie", "tłumaczenie", "meaning",
    "znaczenie", "target", "polski", "polish", "b", "2",
  ],
  [FIELD_EXAMPLE]: [
    "example", "przyklad", "przykład", "sentence", "zdanie", "usage",
    "uzycie", "użycie", "context", "kontekst",
  ],
  [FIELD_PRONUNCIATION]: ["pronunciation", "wymowa", "ipa", "transkrypcja"],
  [FIELD_SYNONYMS]: ["synonyms", "synonimy", "synonim", "parafraza", "opis"],
  // Bez "register"/"rejestr": w trackerze OET to os aktywny/pasywny, ktora
  // idzie w tagi, nie odpowiednik formalny.
  [FIELD_FORMAL]: ["formal", "formalnie", "formalny", "oficjalnie"],
  [TARGET_TAGS]: ["tags", "tagi", "tag", "kategoria", "category", "labels", "etykiety"],
  [TARGET_KIND]: ["kind", "rodzaj", "typ", "type", "item_kind"],
};

function normalizeHeader(name: string): string {
  // NFKD skleja odmiany diakrytykow; "ł" nie ma dekompozycji, stad w klasie.
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9ąćęłńóśźż]+/gu, "");
}

const KNOWN_HEADERS = new Set(
  Object.values(HINTS).flatMap((hints) => hints.map(normalizeHeader)),
);

/** Czy tekst wyglada na nazwe kolumny, a nie na tresc fiszki. */
export function isKnownHeader(name: string): boolean {
  return KNOWN_HEADERS.has(normalizeHeader(name));
}

/**
 * Zgaduje mapowanie po nazwach kolumn, z fallbackiem na kolejnosc.
 * To sugestia do poprawienia przez uzytkownika, nie decyzja.
 */
export function suggestMapping(columns: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();

  for (const column of columns) {
    const normalized = normalizeHeader(column);
    for (const [target, hints] of Object.entries(HINTS)) {
      if (taken.has(target)) continue;
      if (hints.some((hint) => normalizeHeader(hint) === normalized)) {
        mapping[column] = target;
        taken.add(target);
        break;
      }
    }
  }

  // Kolumny bez trafienia: pierwsze dwie wolne dostaja przod i tyl, bo w
  // praktyce prawie kazdy eksport ma je w tej kolejnosci.
  for (const column of columns) {
    if (column in mapping) continue;
    if (!taken.has(FIELD_FRONT)) {
      mapping[column] = FIELD_FRONT;
      taken.add(FIELD_FRONT);
    } else if (!taken.has(FIELD_BACK)) {
      mapping[column] = FIELD_BACK;
      taken.add(FIELD_BACK);
    } else {
      mapping[column] = TARGET_IGNORE;
    }
  }

  return mapping;
}

// --- kategoria materialu ---------------------------------------------------

const KIND_ALIASES: Record<string, ItemKind> = {
  slowo: "word", "słowo": "word", word: "word",
  fraza: "phrase", phrase: "phrase",
  wyrazenie: "expression", "wyrażenie": "expression",
  expression: "expression", idiom: "expression",
  zdanie: "sentence", sentence: "sentence",
  other: "other", inne: "other",
};

export function parseItemKind(value: string): ItemKind | null {
  const candidate = (value ?? "").trim().toLowerCase();
  return KIND_ALIASES[candidate] ?? null;
}

// --- dekodowanie -----------------------------------------------------------

/**
 * Arkusze z Windows czesto wychodza w cp1250, nie w UTF-8. Kolejnosc prob
 * jak w backendzie; latin-1 nigdy nie zawodzi, wiec jest ostatnia deska.
 */
export function decodeBytes(data: Uint8Array): string {
  for (const encoding of ["utf-8", "windows-1250"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(data);
    } catch {
      // probujemy nastepnego kodowania
    }
  }
  return new TextDecoder("iso-8859-1").decode(data);
}
