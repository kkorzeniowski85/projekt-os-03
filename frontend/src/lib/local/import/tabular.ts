/** CSV / TSV - najczestszy wspolny mianownik eksportow (Quizlet, arkusze, kursy). */

import {
  ImportParseError,
  type ParseResult,
  decodeBytes,
  isKnownHeader,
  looksLikeHtml,
  sourceRow,
  suggestMapping,
  toPlainText,
} from "./base";

//: Separatory, ktore realnie wystepuja w eksportach fiszek.
const CANDIDATES = [",", ";", "\t", "|"] as const;

export const MAX_ROWS = 20_000;

/**
 * Wybor separatora: wygrywa ten, ktory pojawia sie w najwiekszej liczbie
 * linii probki (potem: najwiecej wystapien ogolem). Liczenie po liniach
 * jest odporniejsze niz surowa suma - przecinki wewnatrz cytowanych pol
 * nie przeglosuja srednika, ktory dzieli kazda linie.
 */
function sniffDelimiter(sample: string): string {
  const lines = sample.split(/\r?\n/).filter((line) => line.trim()).slice(0, 40);
  let best: string | null = null;
  let bestScore = -1;
  let bestTotal = -1;
  for (const candidate of CANDIDATES) {
    const covered = lines.filter((line) => line.includes(candidate)).length;
    const total = sample.split(candidate).length - 1;
    if (covered > bestScore || (covered === bestScore && total > bestTotal)) {
      best = candidate;
      bestScore = covered;
      bestTotal = total;
    }
  }
  if (!best || bestTotal === 0) {
    throw new ImportParseError(
      "Nie wykryto separatora kolumn. Oczekiwano przecinka, srednika, tabulatora albo pionowej kreski.",
    );
  }
  return best;
}

/** Parser RFC-4180: cudzyslowy, separatory i nowe linie wewnatrz pol. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  rows.push(row);

  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

/**
 * Czy pierwszy wiersz to naglowek, czy juz pierwsza fiszka.
 *
 * Wymagamy twardego dowodu: co najmniej jedna komorka musi byc rozpoznawalna
 * nazwa kolumny. Przy watpliwosci wygrywa "to sa dane": zle nazwana kolumna
 * jest widoczna w podgladzie i do poprawienia jednym przelacznikiem,
 * a zjedzona pierwsza fiszka jest niewidoczna - nikt jej nie szuka,
 * bo nie wie, ze istniala. (Pelne uzasadnienie: ADR 0004.)
 */
function looksLikeHeader(row: string[]): boolean {
  if (row.length === 0 || row.some((cell) => !cell.trim())) return false;
  if (!row.every((cell) => cell.length <= 30 && !/[.?!]\s*$/.test(cell))) return false;
  return row.some((cell) => isKnownHeader(cell));
}

/**
 * Komorka z eksportu potrafi zawierac cale <div style=...> - czyscimy tylko
 * komorki z rozpoznanym znacznikiem, zeby nie zjesc tresci typu "a < b".
 */
function cleanCell(raw: string): string {
  const value = raw ?? "";
  return looksLikeHtml(value) ? toPlainText(value) : value.trim();
}

export function parse(
  data: Uint8Array,
  options?: { hasHeader?: boolean | null },
): ParseResult {
  const text = decodeBytes(data);
  if (!text.trim()) throw new ImportParseError("Plik jest pusty.");

  const delimiter = sniffDelimiter(text.slice(0, 8192));
  const records = parseDelimited(text, delimiter);
  if (records.length === 0) throw new ImportParseError("Plik nie zawiera zadnych wierszy.");

  const warnings: string[] = [];
  const width = Math.max(...records.map((row) => row.length));

  // Jawne ustawienie z interfejsu wygrywa z domyslaniem sie.
  const override = options?.hasHeader;
  const hasHeader =
    override == null
      ? looksLikeHeader(records[0]) && records.length > 1
      : Boolean(override) && records.length > 1;

  let columns: string[];
  let body: string[][];
  if (hasHeader) {
    columns = records[0].map((cell, i) => cell.trim() || `kolumna ${i + 1}`);
    body = records.slice(1);
    warnings.push(
      `Pierwszy wiersz potraktowano jako naglowek: ${columns.join(", ")}. ` +
        "Jesli to juz fiszka, zmien ustawienie i wczytaj plik ponownie.",
    );
  } else {
    columns = Array.from({ length: width }, (_, i) => `kolumna ${i + 1}`);
    body = records;
    warnings.push(
      "Nie wykryto wiersza naglowka - kolumny ponumerowano, a wszystkie " +
        `${records.length} wierszy potraktowano jako fiszki.`,
    );
  }

  for (let i = columns.length; i < width; i += 1) columns.push(`kolumna ${i + 1}`);

  if (body.length > MAX_ROWS) {
    warnings.push(`Plik ma ${body.length} wierszy - zaimportowane zostanie pierwsze ${MAX_ROWS}.`);
    body = body.slice(0, MAX_ROWS);
  }

  if (body.some((row) => row.some((cell) => looksLikeHtml(cell)))) {
    warnings.push(
      "Komorki zawieraly znaczniki HTML (typowe dla eksportu z Anki) - " +
        "zostaly sprowadzone do czystego tekstu.",
    );
  }

  const rows = body.map((row) =>
    sourceRow({
      values: Object.fromEntries(columns.map((column, i) => [column, cleanCell(row[i] ?? "")])),
    }),
  );

  return {
    sourceFormat: "csv",
    columns,
    rows,
    suggestedMapping: suggestMapping(columns),
    warnings,
    sourceDecks: [],
    suggestedNoteType: "basic",
  };
}
