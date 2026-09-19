/**
 * Kopia zapasowa do pliku i przywracanie - funkcja pierwszej klasy (ADR 0006).
 *
 * Dane istnieja wylacznie w pamieci przegladarki jednego urzadzenia, wiec
 * plik kopii jest jedynym zabezpieczeniem przed utrata historii nauki
 * i jedynym sposobem przeniesienia danych na inne urzadzenie.
 *
 * Przywracanie ZASTEPUJE wszystko i dzieje sie w jednej transakcji - po
 * bledzie w polowie stara baza zostaje nietknieta. Scalania nie ma: to
 * swiadome uproszczenie modelu bez synchronizacji.
 */

import { DB_VERSION, db } from "./db";
import type {
  BundledStateRecord,
  CardRecord,
  DeckRecord,
  NoteRecord,
  ReviewLogRecord,
  SettingsRecord,
} from "./types";

export const BACKUP_FORMAT = "fiszki-backup/v1";

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  exportedAt: string;
  /** Wersja schematu IndexedDB - przy przyszlych migracjach powie, jak czytac. */
  schema: number;
  data: {
    decks: DeckRecord[];
    notes: NoteRecord[];
    cards: CardRecord[];
    reviewLog: ReviewLogRecord[];
    settings: Array<SettingsRecord | BundledStateRecord>;
  };
}

export interface BackupCounts {
  decks: number;
  notes: number;
  cards: number;
  reviews: number;
}

const STORES = ["decks", "notes", "cards", "reviewLog", "settings"] as const;

export function backupCounts(payload: BackupFile): BackupCounts {
  return {
    decks: payload.data.decks.length,
    notes: payload.data.notes.length,
    cards: payload.data.cards.length,
    reviews: payload.data.reviewLog.length,
  };
}

export async function currentCounts(): Promise<BackupCounts> {
  const database = await db();
  return {
    decks: await database.count("decks"),
    notes: await database.count("notes"),
    cards: await database.count("cards"),
    reviews: await database.count("reviewLog"),
  };
}

export async function exportBackup(now: Date = new Date()): Promise<BackupFile> {
  const database = await db();
  return {
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    schema: DB_VERSION,
    data: {
      decks: await database.getAll("decks"),
      notes: await database.getAll("notes"),
      cards: await database.getAll("cards"),
      reviewLog: await database.getAll("reviewLog"),
      settings: await database.getAll("settings"),
    },
  };
}

/** Nazwa pliku z lokalna data - "fiszki-kopia-2026-08-04-1930.json". */
export function backupFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `fiszki-kopia-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}.json`
  );
}

/** Waliduje wczytany plik. Rzuca bledem nadajacym sie do pokazania wprost. */
export function parseBackup(text: string): BackupFile {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("To nie jest plik JSON.");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Plik nie wyglada na kopie zapasowa.");
  }
  const candidate = payload as Record<string, unknown>;
  if (candidate.format !== BACKUP_FORMAT) {
    throw new Error(
      `Plik nie jest kopia zapasowa tej aplikacji (format: ${String(candidate.format ?? "brak")}). ` +
        "Talie w formacie fiszki/v1 wczytuje sie przez ekran Import.",
    );
  }
  // Wersja schematu: brak = kopia sprzed wprowadzenia pola, czyli 1.
  // Kopia z NOWSZEJ wersji moze zawierac sklepy i pola, ktorych ta wersja
  // nie zna - wczytanie jej po cichu zgubiloby dane.
  const schema = candidate.schema === undefined ? 1 : candidate.schema;
  if (typeof schema !== "number" || !Number.isFinite(schema)) {
    throw new Error("Kopia ma uszkodzone oznaczenie wersji.");
  }
  if (schema > DB_VERSION) {
    throw new Error(
      "Ta kopia pochodzi z nowszej wersji aplikacji. Zaktualizuj aplikację i spróbuj ponownie.",
    );
  }
  const data = candidate.data as Record<string, unknown> | undefined;
  for (const store of STORES) {
    if (!Array.isArray(data?.[store])) {
      throw new Error(`Kopia jest uszkodzona - brak sekcji '${store}'.`);
    }
  }
  return payload as BackupFile;
}

/**
 * Zastepuje cala baze zawartoscia kopii. Jedna transakcja: gdy cokolwiek
 * pojdzie zle, stare dane zostaja nietkniete.
 */
export async function restoreBackup(payload: BackupFile): Promise<BackupCounts> {
  const database = await db();
  const tx = database.transaction([...STORES], "readwrite");
  try {
    for (const store of STORES) {
      await tx.objectStore(store).clear();
      for (const record of payload.data[store]) {
        await tx.objectStore(store).put(record as never);
      }
    }
    await tx.done;
  } catch (caught) {
    // Przerwanie MUSI byc jawne. Gdy put() rzuca synchronicznie (rekord bez
    // klucza w uszkodzonej kopii), IndexedDB nie widzi nieudanego zadania
    // i spokojnie zatwierdza to, co zdazylo sie wykonac - czyli wyczyszczone
    // magazyny. Bez tego bloku wczytanie uszkodzonego pliku kasowalo cala
    // kolekcje. Pilnuje tego test "uszkodzona kopia nie kasuje danych".
    try {
      tx.abort();
    } catch {
      // transakcja juz zakonczona - nie ma czego przerywac
    }
    void tx.done.catch(() => {}); // wycofanie zglasza AbortError; to oczekiwane
    throw new Error(
      `Nie udalo sie przywrocic kopii: ${(caught as Error).message}. ` +
        "Dotychczasowe dane pozostaly bez zmian.",
    );
  }
  // Po zatwierdzeniu, w OSOBNEJ transakcji: kopia sprzed wprowadzenia pol
  // adnotacji ma je sklejone w przykladzie. Blok wyzej ma catch, ktory
  // przerywa transakcje i zglasza nieudane przywrocenie - wyjatek z naprawy
  // zamienilby udane przywrocenie w nieudane, wiec porazka jest tu cicha.
  try {
    const { naprawPrzyklady } = await import("./repo");
    await naprawPrzyklady();
  } catch {
    // Dane sa przywrocone; porzadek zrobi sie przy nastepnym otwarciu.
  }

  return backupCounts(payload);
}
