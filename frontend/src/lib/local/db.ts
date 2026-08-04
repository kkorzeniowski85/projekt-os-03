/** Schemat IndexedDB i dostep do bazy. */

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";

import type {
  CardRecord,
  DeckRecord,
  NoteRecord,
  ReviewLogRecord,
  SettingsRecord,
} from "./types";

export interface FiszkiDB extends DBSchema {
  decks: { key: string; value: DeckRecord };
  notes: {
    key: string;
    value: NoteRecord;
    indexes: { "by-deck": string; "by-hash": string };
  };
  cards: {
    key: string;
    value: CardRecord;
    // by-deck-due: zakres [deckId, due] - kolejka zaleglych bez skanu talii.
    indexes: { "by-deck": string; "by-note": string; "by-deck-due": [string, string] };
  };
  reviewLog: {
    key: string;
    value: ReviewLogRecord;
    // by-deck-time: dzisiejsze liczniki (limit nowych i powtorek na dzien).
    indexes: { "by-card": string; "by-time": string; "by-deck-time": [string, string] };
  };
  settings: { key: string; value: SettingsRecord };
}

export const DB_NAME = "fiszki";
const DB_VERSION = 1;

let handle: Promise<IDBPDatabase<FiszkiDB>> | null = null;

export function db(): Promise<IDBPDatabase<FiszkiDB>> {
  handle ??= openDB<FiszkiDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore("decks", { keyPath: "id" });

      const notes = database.createObjectStore("notes", { keyPath: "id" });
      notes.createIndex("by-deck", "deckId");
      notes.createIndex("by-hash", "contentHash");

      const cards = database.createObjectStore("cards", { keyPath: "id" });
      cards.createIndex("by-deck", "deckId");
      cards.createIndex("by-note", "noteId");
      cards.createIndex("by-deck-due", ["deckId", "due"]);

      const log = database.createObjectStore("reviewLog", { keyPath: "id" });
      log.createIndex("by-card", "cardId");
      log.createIndex("by-time", "reviewDatetime");
      log.createIndex("by-deck-time", ["deckId", "reviewDatetime"]);

      database.createObjectStore("settings", { keyPath: "id" });
    },
  });
  return handle;
}

/** Testy oraz awaryjny reset. Kasuje WSZYSTKIE dane lokalne. */
export async function closeAndDeleteDb(): Promise<void> {
  if (handle) (await handle).close();
  handle = null;
  await deleteDB(DB_NAME);
}

/**
 * Prosba o trwala pamiec - bez niej przegladarka moze w potrzebie wyczyscic
 * dane strony. Na Androidzie dla zainstalowanej PWA zwykle przyznawana
 * automatycznie. Wolane z UI po starcie; false nie jest bledem.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    // persisted() nie pyta uzytkownika; persist() moze. Gdy zgoda juz jest,
    // nie zaczepiamy go ponownie.
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Stan pamieci na potrzeby ekranu ustawien. */
export async function storageEstimate(): Promise<{
  persisted: boolean;
  usageMb: number | null;
}> {
  if (typeof navigator === "undefined" || !navigator.storage) {
    return { persisted: false, usageMb: null };
  }
  try {
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    const usage = (await navigator.storage.estimate?.())?.usage ?? null;
    return {
      persisted,
      usageMb: usage === null ? null : Math.round((usage / (1024 * 1024)) * 10) / 10,
    };
  } catch {
    return { persisted: false, usageMb: null };
  }
}
