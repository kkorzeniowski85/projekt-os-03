/**
 * Slownik wbudowany: pakiet fiszek dostarczany razem z aplikacja.
 *
 * Aplikacja nie ma serwera (ADR 0006), wiec jedyna droga, ktora tresc moze
 * dotrzec na telefon bez reki uzytkownika, jest ta sama, ktora przychodzi
 * nowa wersja aplikacji: pliki statyczne na hostingu. Pakiet to katalog
 * public/slownik/ z plikami fiszki/v1 i manifestem - lista plikow
 * z odciskami, generowana przy budowaniu (scripts/slownik-manifest.mjs).
 *
 * Po otwarciu aplikacji (i na zadanie z ekranu ustawien) pobieramy manifest,
 * porownujemy odciski z tym, co juz weszlo, i wprowadzamy TYLKO zmienione
 * pliki - trybem, ktory uzupelnia i nie rusza stanu nauki. Postep nauki nie
 * plynie w druga strone: to nie jest synchronizacja, tylko dostawa tresci.
 * Patrz ADR 0007.
 *
 * Trzy zasady, ktorych ten modul pilnuje:
 *   - poprawka w repozytorium trafia w TE SAMA fiszke (po source_ref),
 *     nie tworzy drugiej obok
 *   - fiszki poprawionej recznie pakiet nie nadpisuje - tylko dopisuje to,
 *     czego jej brakuje
 *   - fiszka skasowana recznie nie wraca
 */

import { BUNDLED_STATE_ID, asBundledState } from "./bundled-state";
import { db } from "./db";
import { parseSource } from "./import";
import { commitImport, normalize } from "./import/service";
import { DICTIONARY_DECK_ID, ensureDictionary } from "./repo";
import type { BundledStateRecord } from "./types";

export const MANIFEST_FORMAT = "slownik-manifest/v1";

//: Prefiks hostingu - na GitHub Pages aplikacja stoi w podkatalogu.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const BUNDLED_DIR = `${BASE}/slownik`;
export const MANIFEST_URL = `${BUNDLED_DIR}/manifest.json`;

/** Zdarzenie okna po wprowadzeniu zmian - ekrany odswiezaja liczniki. */
export const BUNDLED_EVENT = "slownik-wbudowany:zmiana";

export interface BundledFile {
  path: string;
  sha256: string;
  notes: number;
}

export interface BundledManifest {
  format: typeof MANIFEST_FORMAT;
  files: BundledFile[];
}

export type BundledStatus = "up-to-date" | "applied" | "offline" | "error";

export interface BundledResult {
  status: BundledStatus;
  imported: number;
  updated: number;
  /** Pliki, ktore weszly w tym przebiegu. */
  files: number;
  /** Pliki pominiete: odcisk niezgodny z manifestem albo plik nie do odczytania. */
  failed: string[];
  message: string | null;
}

/**
 * Odcisk pliku pakietu - ta sama miara co w scripts/slownik-manifest.mjs.
 *
 * Konce linii ujednolicone: git na Windows potrafi je podmienic przy
 * pobraniu, a odcisk ma opisywac tresc, nie platforme.
 */
export async function fileHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.replace(/\r\n/g, "\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseManifest(raw: unknown): BundledManifest {
  if (!raw || typeof raw !== "object") throw new Error("Manifest pakietu nie jest obiektem");
  const candidate = raw as { format?: unknown; files?: unknown };
  if (candidate.format !== MANIFEST_FORMAT) {
    throw new Error(`Nieznany format manifestu: ${String(candidate.format ?? "brak")}`);
  }
  if (!Array.isArray(candidate.files)) throw new Error("Manifest pakietu nie ma listy plików");

  const files: BundledFile[] = [];
  for (const entry of candidate.files as unknown[]) {
    const file = entry as { path?: unknown; sha256?: unknown; notes?: unknown };
    // Sciezka to sama nazwa pliku - manifest nie moze wyslac nas poza katalog.
    if (
      typeof file.path !== "string" ||
      !/^[\w.-]+\.json$/.test(file.path) ||
      typeof file.sha256 !== "string"
    ) {
      throw new Error("Manifest pakietu ma uszkodzony wpis");
    }
    files.push({
      path: file.path,
      sha256: file.sha256,
      notes: typeof file.notes === "number" ? file.notes : 0,
    });
  }
  return { format: MANIFEST_FORMAT, files };
}

export async function bundledState(): Promise<BundledStateRecord> {
  const database = await db();
  return asBundledState(await database.get("settings", BUNDLED_STATE_ID));
}

/** Pliki, ktorych obecna wersja jeszcze nie weszla. */
export function pendingFiles(manifest: BundledManifest, state: BundledStateRecord): BundledFile[] {
  return manifest.files.filter((file) => state.files[file.path] !== file.sha256);
}

type FetchFn = typeof fetch;

async function fetchText(url: string, fetchFn: FetchFn): Promise<string> {
  // no-store: chodzi o swieza wersje, nie o to, co pamieta przegladarka.
  // Service worker tej sciezki celowo nie przechwytuje (public/sw.js).
  const response = await fetchFn(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} dla ${url}`);
  return response.text();
}

/** fetch odrzuca TypeError, gdy nie ma sieci albo host nie odpowiada. */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Sprawdza pakiet i wprowadza zmiany do Slownika.
 *
 * Bezpieczne do wolania przy kazdym starcie: bez sieci konczy sie po cichu,
 * bez zmian nic nie zapisuje, a fiszek skasowanych recznie nie przywraca.
 * Plik z odciskiem niezgodnym z manifestem (urwane pobranie, stara kopia
 * na CDN) jest pomijany i zostaje "do wprowadzenia" na nastepny raz.
 */
export async function applyBundled(
  options: { now?: Date; fetchFn?: FetchFn } = {},
): Promise<BundledResult> {
  const now = options.now ?? new Date();
  const fetchFn = options.fetchFn ?? fetch;
  const result: BundledResult = {
    status: "up-to-date",
    imported: 0,
    updated: 0,
    files: 0,
    failed: [],
    message: null,
  };

  let manifest: BundledManifest;
  try {
    manifest = parseManifest(JSON.parse(await fetchText(MANIFEST_URL, fetchFn)));
  } catch (error) {
    if (isNetworkError(error)) {
      result.status = "offline";
      result.message = "Brak połączenia z siecią.";
    } else {
      result.status = "error";
      result.message =
        error instanceof Error ? error.message : "Nie udało się odczytać pakietu.";
    }
    return result;
  }

  const state = await bundledState();
  const pending = pendingFiles(manifest, state);
  if (pending.length === 0) return result;

  await ensureDictionary(now);
  const removed = new Set(state.removed);
  const files = { ...state.files };

  for (const file of pending) {
    try {
      const text = await fetchText(`${BUNDLED_DIR}/${file.path}`, fetchFn);
      if ((await fileHash(text)) !== file.sha256) {
        throw new Error("odcisk pliku nie zgadza się z manifestem");
      }
      const parsed = parseSource(file.path, new TextEncoder().encode(text));
      const drafts = (await normalize(parsed, parsed.suggestedMapping)).filter(
        (draft) =>
          !removed.has(draft.contentHash) &&
          !(draft.sourceRef !== null && removed.has(draft.sourceRef)),
      );
      const stats = await commitImport(DICTIONARY_DECK_ID, drafts, {
        noteType: "basic_reversed",
        authoritative: true,
        now,
      });
      result.imported += stats.imported;
      result.updated += stats.updated;
      result.files += 1;
      files[file.path] = file.sha256;
    } catch (error) {
      result.failed.push(
        `${file.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (result.files === 0) {
    result.status = "error";
    result.message = "Nie udało się wprowadzić żadnego pliku pakietu.";
    return result;
  }

  // Plik usuniety z pakietu przestaje byc sledzony. Jego fiszki zostaja -
  // pakiet nigdy nie kasuje.
  for (const path of Object.keys(files)) {
    if (!manifest.files.some((file) => file.path === path)) delete files[path];
  }

  const database = await db();
  await database.put("settings", { ...state, files, appliedAt: now.toISOString() });

  result.status = "applied";
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(BUNDLED_EVENT));
  return result;
}
