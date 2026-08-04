/**
 * Format wlasny aplikacji - `fiszki/v1` (specyfikacja: docs/format-fiszki-v1.md).
 *
 * Format docelowy: kolumny sa juz docelowe, wiec import przechodzi bez
 * mapowania. Najwygodniejszy sposob dostarczenia gotowej talii z zewnatrz.
 */

import type { NoteType } from "@/lib/types";

import { FIELD_BACK, FIELD_EXAMPLE, FIELD_FRONT } from "../content";
import {
  ImportParseError,
  TARGET_KIND,
  TARGET_TAGS,
  type ParseResult,
  type SourceRow,
  sourceRow,
} from "./base";

export const FORMAT_ID = "fiszki/v1";

//: Klucz w JSON -> kolumna posrednia (nazwa widoczna pozniej w mapowaniu).
const KEYS: Record<string, string> = {
  front: FIELD_FRONT,
  back: FIELD_BACK,
  example: FIELD_EXAMPLE,
  tags: TARGET_TAGS,
  kind: TARGET_KIND,
};

function asText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

const NOTE_TYPES: NoteType[] = ["basic", "basic_reversed"];

function envelopeNoteType(value: unknown, warnings: string[]): NoteType {
  if (value == null) return "basic";
  if (NOTE_TYPES.includes(value as NoteType)) return value as NoteType;
  warnings.push(`Nieznany typ notatki '${String(value)}' - uzyto jednostronnego.`);
  return "basic";
}

/**
 * Typ notatki podany przy pojedynczej pozycji. null oznacza "uzyj typu
 * wybranego przy imporcie" - inaczej niz w kopercie, gdzie brak wartosci
 * oznacza wprost typ jednostronny.
 */
function itemNoteType(value: unknown, index: number, warnings: string[]): NoteType | null {
  if (value == null || !String(value).trim()) return null;
  const candidate = String(value).trim();
  if (NOTE_TYPES.includes(candidate as NoteType)) return candidate as NoteType;
  warnings.push(`Pozycja ${index}: nieznany typ notatki '${candidate}' - uzyto typu z importu.`);
  return null;
}

export function parse(data: Uint8Array): ParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8").decode(data));
  } catch (caught) {
    throw new ImportParseError(`Nieprawidlowy JSON: ${(caught as Error).message}`);
  }

  const warnings: string[] = [];
  let notes: unknown[];
  let deckName: string | null = null;
  let defaultNoteType: NoteType = "basic";

  if (Array.isArray(payload)) {
    notes = payload;
    warnings.push("Plik bez koperty - przyjeto wartosci domyslne.");
  } else if (payload && typeof payload === "object") {
    const envelope = payload as Record<string, unknown>;
    const declared = envelope.format;
    if (declared && declared !== FORMAT_ID) {
      warnings.push(`Plik deklaruje format '${String(declared)}', oczekiwano '${FORMAT_ID}'.`);
    }
    if (!Array.isArray(envelope.notes)) {
      throw new ImportParseError("Brak listy 'notes'.");
    }
    notes = envelope.notes;
    deckName = asText(envelope.deck) || null;
    defaultNoteType = envelopeNoteType(envelope.default_note_type, warnings);
  } else {
    throw new ImportParseError("Oczekiwano obiektu albo listy na najwyzszym poziomie.");
  }

  const rows: SourceRow[] = [];
  notes.forEach((note, i) => {
    const index = i + 1;
    if (!note || typeof note !== "object" || Array.isArray(note)) {
      warnings.push(`Pozycja ${index}: pominieta (nie jest obiektem).`);
      return;
    }
    const item = note as Record<string, unknown>;

    const values = Object.fromEntries(
      Object.entries(KEYS).map(([key, column]) => [column, asText(item[key])]),
    );
    if (!values[FIELD_FRONT].trim() || !values[FIELD_BACK].trim()) {
      warnings.push(`Pozycja ${index}: pominieta (pusty przod albo tyl).`);
      return;
    }

    rows.push(
      sourceRow({
        values,
        sourceRef: asText(item.source_ref) || null,
        sourceDeck: asText(item.deck) || deckName,
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        noteType: itemNoteType(item.note_type, index, warnings),
      }),
    );
  });

  if (rows.length === 0) {
    throw new ImportParseError("Plik nie zawiera zadnej kompletnej fiszki.");
  }

  return {
    sourceFormat: "fiszki-json",
    columns: Object.values(KEYS),
    rows,
    // Format kanoniczny nie wymaga zgadywania - kolumny sa juz docelowe.
    suggestedMapping: Object.fromEntries(Object.values(KEYS).map((c) => [c, c])),
    warnings,
    sourceDecks: [...new Set(rows.map((r) => r.sourceDeck).filter((d): d is string => !!d))].sort(),
    suggestedNoteType: defaultNoteType,
  };
}
