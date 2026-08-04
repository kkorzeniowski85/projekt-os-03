/**
 * Wspolne typy dziedzinowe aplikacji.
 *
 * Kiedys lustro schematow Pydantica z backendu - po zwrocie na local-first
 * (ADR 0006) zostalo tylko to, czego ekrany i warstwa lokalna naprawde
 * uzywaja. Rekordy danych mieszkaja w lib/local/types.ts.
 */

export type NoteType = "basic" | "basic_reversed";

/** Kategoria materialu - os, wzdluz ktorej liczone sa statystyki. */
export type ItemKind = "word" | "phrase" | "expression" | "sentence" | "other";

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  word: "słowo",
  phrase: "fraza",
  expression: "wyrażenie",
  sentence: "zdanie",
  other: "inne",
};

/** 1 = Znowu, 2 = Trudne, 3 = Dobre, 4 = Latwe (zgodnie z ts-fsrs Rating). */
export type Rating = 1 | 2 | 3 | 4;

export const RATING_LABELS: Record<Rating, string> = {
  1: "Znowu",
  2: "Trudne",
  3: "Dobre",
  4: "Latwe",
};

/** Etykiety celow mapowania kolumn przy imporcie. */
export const MAPPING_TARGET_LABELS: Record<string, string> = {
  Front: "Przód",
  Back: "Tył",
  Example: "Przykład",
  tags: "Tagi",
  kind: "Kategoria",
  ignore: "— pomiń —",
};
