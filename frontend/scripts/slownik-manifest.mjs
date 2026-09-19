#!/usr/bin/env node
/**
 * Generuje public/slownik/manifest.json: liste plikow pakietu wbudowanego
 * z odciskami. Uruchamiany automatycznie przed `next build` i `next dev`
 * (prebuild/predev w package.json), wiec o manifescie nie trzeba pamietac.
 *
 *     node scripts/slownik-manifest.mjs [katalog]
 *
 * Odcisk liczony z tresci po ujednoliceniu koncow linii - ta sama miara,
 * ktora aplikacja sprawdza pobrany plik (src/lib/local/bundled.ts).
 *
 * Odmawia w dwoch przypadkach, bo oba psuja aktualizacje po cichu:
 *   - fiszka bez source_ref: po nim aplikacja odnajduje fiszke, gdy poprawka
 *     tlumaczenia zmieni odcisk tresci. Bez niego poprawka tworzylaby
 *     druga fiszke obok starej.
 *   - ta sama tresc w dwoch plikach: fiszka zostalaby z jednym source_ref,
 *     a poprawka w drugim pliku znow dawalaby duplikat. Jedna tresc, jedno
 *     zrodlo.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_FORMAT = "slownik-manifest/v1";

export function fileHash(text) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

//: Ta sama normalizacja co contentHash() w aplikacji - inaczej skrypt
//: przepuscilby duplikat, ktory aplikacja i tak by scalila.
const normalize = (value) =>
  String(value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export function buildManifest(dir) {
  mkdirSync(dir, { recursive: true });
  const files = [];
  const seen = new Map();
  const seenRefs = new Map();

  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json") || name === "manifest.json") continue;
    const text = readFileSync(join(dir, name), "utf8");

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`${name}: to nie jest poprawny JSON (${error.message})`);
    }
    if (payload?.format !== "fiszki/v1" || !Array.isArray(payload.notes)) {
      throw new Error(`${name}: pakiet przyjmuje tylko pliki fiszki/v1 z lista "notes"`);
    }

    for (const note of payload.notes) {
      if (!note.source_ref) {
        throw new Error(
          `${name}: fiszka "${note.front}" nie ma source_ref - pakiet wymaga stalego ` +
            "identyfikatora, po nim trafiaja poprawki",
        );
      }
      const refOwner = seenRefs.get(note.source_ref);
      if (refOwner) {
        throw new Error(
          `${name}: source_ref "${note.source_ref}" jest juz uzyty w ${refOwner} - ` +
            "identyfikator musi byc unikalny w calym pakiecie",
        );
      }
      seenRefs.set(note.source_ref, name);

      // Literowka w kluczu ("synonims") przechodzilaby bez slowa, a importer
      // po cichu wyrzucilby wartosc - dokladnie ten rodzaj cichej porazki,
      // przed ktorym ten skrypt istnieje.
      for (const klucz of ["pronunciation", "synonyms", "formal"]) {
        const wartosc = note[klucz];
        if (wartosc === undefined || wartosc === null) continue;
        const dobre =
          typeof wartosc === "string" ||
          (Array.isArray(wartosc) && wartosc.every((x) => typeof x === "string"));
        if (!dobre) {
          throw new Error(
            `${name}: fiszka "${note.front}" ma pole ${klucz} ktore nie jest ` +
              "napisem ani lista napisow",
          );
        }
      }
      const key = [normalize(note.front), normalize(note.back)].join("\x1f");
      const other = seen.get(key);
      if (other && other !== name) {
        throw new Error(
          `${name}: fiszka "${note.front}" jest juz w ${other} - jedna tresc, jedno zrodlo`,
        );
      }
      seen.set(key, name);
    }

    files.push({ path: name, sha256: fileHash(text), notes: payload.notes.length });
  }

  return { format: MANIFEST_FORMAT, files };
}

export function writeManifest(dir) {
  const manifest = buildManifest(dir);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const dir = process.argv[2]
    ? resolve(process.argv[2])
    : join(dirname(fileURLToPath(import.meta.url)), "..", "public", "slownik");
  try {
    const manifest = writeManifest(dir);
    const notes = manifest.files.reduce((sum, file) => sum + file.notes, 0);
    console.log(
      `slownik: ${manifest.files.length} plik(ow), ${notes} fiszek -> ${join(dir, "manifest.json")}`,
    );
  } catch (error) {
    console.error(`slownik: ${error.message}`);
    process.exit(1);
  }
}
