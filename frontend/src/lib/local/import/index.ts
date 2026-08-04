/**
 * Rejestr importerow i wykrywanie formatu.
 *
 * Dodanie zrodla = jeden modul z parse(data) -> ParseResult plus wpis w
 * FORMATS. Anki (.apkg) wymaga SQLite w przegladarce i wejdzie pozniej
 * (ADR 0006) - wykrywamy go i mowimy wprost, co zrobic w miedzyczasie.
 */

import {
  ImportParseError,
  type ParseResult,
  capWarnings,
} from "./base";
import * as canonical from "./canonical";
import * as plaintext from "./plaintext";
import * as tabular from "./tabular";

export interface Format {
  key: string;
  label: string;
  extensions: readonly string[];
  description: string;
  parse: (data: Uint8Array, options?: { hasHeader?: boolean | null }) => ParseResult;
}

export const FORMATS: readonly Format[] = [
  {
    key: "fiszki-json",
    label: "Format wlasny (fiszki/v1)",
    extensions: [".json"],
    description: "Format docelowy aplikacji. Nie wymaga mapowania kolumn.",
    parse: (data) => canonical.parse(data),
  },
  {
    key: "csv",
    label: "CSV / TSV",
    extensions: [".csv", ".tsv"],
    description: "Arkusze, eksport z Quizletu i wiekszosci kursow.",
    parse: tabular.parse,
  },
  {
    key: "text",
    label: "Zwykly tekst",
    extensions: [".txt", ".md"],
    description: "Jedna fiszka na linie, np. 'kot - cat'.",
    parse: (data) => plaintext.parse(data),
  },
];

const BY_KEY = new Map(FORMATS.map((format) => [format.key, format]));

export function getFormat(key: string): Format {
  const format = BY_KEY.get(key);
  if (!format) throw new ImportParseError(`Nieznany format '${key}'.`);
  return format;
}

/**
 * Rozpoznaje format po zawartosci, a rozszerzenie traktuje jako podpowiedz.
 * Zawartosc ma pierwszenstwo: plik nazwany .txt bywa CSV-em, a .json bywa
 * naga lista notatek.
 */
export function detectFormat(filename: string, data: Uint8Array): Format {
  if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
    throw new ImportParseError(
      "To plik Anki (.apkg) - jego obsluga w wersji lokalnej wejdzie pozniej. " +
        "Na razie wyeksportuj talie z Anki jako 'Notes in Plain Text' (.txt) i wczytaj ten plik.",
    );
  }

  const head = new TextDecoder("utf-8").decode(data.slice(0, 2048)).trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return getFormat("fiszki-json");

  const lowered = filename.toLowerCase();
  for (const format of FORMATS) {
    if (format.extensions.some((ext) => lowered.endsWith(ext))) return format;
  }

  // Bez rozstrzygajacego rozszerzenia: separator kolumn decyduje, czy to
  // tabela, czy lista linii.
  const sample = new TextDecoder("utf-8").decode(data.slice(0, 4096));
  const separators =
    (sample.match(/,/g)?.length ?? 0) +
    (sample.match(/;/g)?.length ?? 0) +
    (sample.match(/\t/g)?.length ?? 0);
  if (separators >= Math.max(sample.split("\n").length - 1, 1)) return getFormat("csv");
  return getFormat("text");
}

export function parseSource(
  filename: string,
  data: Uint8Array,
  formatKey?: string | null,
  options?: { hasHeader?: boolean | null },
): ParseResult {
  const format = formatKey ? getFormat(formatKey) : detectFormat(filename, data);
  const result = format.parse(data, options);
  return { ...result, warnings: capWarnings(result.warnings) };
}

export * from "./base";
