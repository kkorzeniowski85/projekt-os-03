/**
 * Zwykly tekst: jedna fiszka na linie, przod i tyl rozdzielone separatorem.
 * Format do szybkiego wklejenia listy.
 */

import {
  ImportParseError,
  type ParseResult,
  decodeBytes,
  sourceRow,
  suggestMapping,
} from "./base";

export const COLUMN_FRONT = "przod";
export const COLUMN_BACK = "tyl";

//: Kolejnosc ma znaczenie - tabulator jest jednoznaczny, myslnik bywa czescia
//: tresci, wiec wymaga spacji po obu stronach.
const SEPARATORS = ["\t", " — ", " – ", " - ", " = ", " | ", ";"] as const;

export const MAX_ROWS = 20_000;

export function parse(data: Uint8Array): ParseResult {
  const lines = decodeBytes(data)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) {
    throw new ImportParseError("Plik nie zawiera zadnych linii z trescia.");
  }

  // Wybieramy separator, ktory dzieli najwiecej linii.
  let separator: string = SEPARATORS[0];
  let bestScore = -1;
  for (const candidate of SEPARATORS) {
    const score = lines.filter((line) => line.includes(candidate)).length;
    if (score > bestScore) {
      separator = candidate;
      bestScore = score;
    }
  }
  if (bestScore === 0) {
    throw new ImportParseError(
      "Nie wykryto separatora. Oczekiwano tabulatora albo myslnika ze spacjami (np. 'kot - cat').",
    );
  }

  const warnings: string[] = [];
  const rows = [];
  let skipped = 0;

  for (const line of lines.slice(0, MAX_ROWS)) {
    const at = line.indexOf(separator);
    const front = at >= 0 ? line.slice(0, at).trim() : "";
    const back = at >= 0 ? line.slice(at + separator.length).trim() : "";
    if (at < 0 || !front || !back) {
      skipped += 1;
      continue;
    }
    rows.push(sourceRow({ values: { [COLUMN_FRONT]: front, [COLUMN_BACK]: back } }));
  }

  if (skipped) {
    warnings.push(`Pominieto ${skipped} linii bez separatora albo z pusta strona.`);
  }
  if (rows.length === 0) {
    throw new ImportParseError("Zadna linia nie dala sie podzielic na przod i tyl.");
  }

  const columns = [COLUMN_FRONT, COLUMN_BACK];
  return {
    sourceFormat: "text",
    columns,
    rows,
    suggestedMapping: suggestMapping(columns),
    warnings,
    sourceDecks: [],
    suggestedNoteType: "basic",
  };
}
