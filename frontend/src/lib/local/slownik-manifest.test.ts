/**
 * Skrypt generujacy manifest pakietu (scripts/slownik-manifest.mjs).
 *
 * Uruchamiany jak przy budowaniu - osobnym procesem node - zeby test
 * sprawdzal to, co naprawde odpala `npm run build`, a nie import funkcji
 * w innych warunkach.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { MANIFEST_FORMAT, fileHash } from "./bundled";

const SCRIPT = resolve(__dirname, "../../../scripts/slownik-manifest.mjs");

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function katalog(pliki: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "slownik-"));
  for (const [name, text] of Object.entries(pliki)) writeFileSync(join(dir, name), text);
  return dir;
}

function uruchom(katalogPakietu: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, katalogPakietu], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out };
  } catch (error) {
    const failed = error as { stderr?: string; stdout?: string };
    return { ok: false, out: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

const talia = (notes: object[]) => JSON.stringify({ format: "fiszki/v1", notes }, null, 2);
const KOT = { front: "kot", back: "cat", source_ref: "demo/kot" };
const PIES = { front: "pies", back: "dog", source_ref: "demo/pies" };

it("liczy odciski ta sama miara, ktora sprawdza aplikacja", async () => {
  const text = talia([KOT, PIES]);
  const wynik = uruchom(katalog({ "a.json": text, "notatka.txt": "nie json" }));
  expect(wynik.ok).toBe(true);

  const manifest = JSON.parse(readFileSync(join(dir!, "manifest.json"), "utf8"));
  expect(manifest.format).toBe(MANIFEST_FORMAT);
  expect(manifest.files).toEqual([{ path: "a.json", sha256: await fileHash(text), notes: 2 }]);
});

it("pusty katalog daje pusty manifest, nie blad", () => {
  const wynik = uruchom(katalog({}));
  expect(wynik.ok).toBe(true);
  expect(JSON.parse(readFileSync(join(dir!, "manifest.json"), "utf8")).files).toEqual([]);
});

it("odmawia, gdy ta sama tresc jest w dwoch plikach", () => {
  const wynik = uruchom(
    katalog({
      "a.json": talia([KOT]),
      "b.json": talia([{ ...KOT, source_ref: "inne/kot", back: "  CAT " }]),
    }),
  );
  expect(wynik.ok).toBe(false);
  expect(wynik.out).toContain("jedna tresc, jedno zrodlo");
});

it("odmawia fiszce bez source_ref", () => {
  const wynik = uruchom(katalog({ "a.json": talia([{ front: "kot", back: "cat" }]) }));
  expect(wynik.ok).toBe(false);
  expect(wynik.out).toContain("source_ref");
});

it("odmawia plikowi, ktory nie jest fiszki/v1", () => {
  const wynik = uruchom(katalog({ "a.json": JSON.stringify([{ front: "kot", back: "cat" }]) }));
  expect(wynik.ok).toBe(false);
  expect(wynik.out).toContain("fiszki/v1");
});
