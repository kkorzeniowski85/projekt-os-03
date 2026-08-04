/**
 * Normalizacja zaimportowanych danych i zapis do IndexedDB - port
 * backend/app/services/importing.py.
 *
 * Tu konczy sie roznorodnosc zrodel: wejsciem jest ParseResult z dowolnego
 * importera plus mapowanie kolumn, wyjsciem zawsze ta sama struktura notatki.
 */

import type { ItemKind, NoteType } from "@/lib/types";

import {
  FIELD_BACK,
  FIELD_FRONT,
  KNOWN_FIELDS,
  contentHash,
  guessItemKind,
} from "../content";
import { db } from "../db";
import { newCardSnapshot } from "../scheduler";
import type { CardRecord, NoteRecord } from "../types";
import { TARGET_KIND, TARGET_TAGS, type ParseResult, parseItemKind } from "./base";

//: Ile znormalizowanych pozycji pokazuje podglad.
export const PREVIEW_SIZE = 10;

export interface NoteDraft {
  fields: Record<string, string>;
  tags: string[];
  itemKind: ItemKind;
  sourceRef: string | null;
  sourceDeck: string | null;
  /** Typ narzucony przez zrodlo dla tej pozycji. null = typ wybrany przy imporcie. */
  noteType: NoteType | null;
  contentHash: string;
}

function splitTags(raw: string): string[] {
  return raw
    .replace(/;/g, ",")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Zamienia wiersze zrodla na notatki w formacie aplikacji.
 *
 * `defaultKind` bez wartosci oznacza zgadywanie kategorii z tresci przodu.
 * Jawna wartosc wygrywa z heurystyka, ale przegrywa z kolumna zrodla
 * zmapowana na `kind` - zrodlo wie lepiej niz nasze domyslne ustawienie.
 */
export async function normalize(
  result: ParseResult,
  mapping: Record<string, string>,
  defaultKind?: ItemKind | null,
): Promise<NoteDraft[]> {
  const drafts: Array<Omit<NoteDraft, "contentHash">> = [];

  for (const row of result.rows) {
    const fields: Record<string, string> = {};
    const tags = [...row.tags];
    let kind: ItemKind | null = null;

    for (const [column, target] of Object.entries(mapping)) {
      const value = (row.values[column] ?? "").trim();
      if (!value) continue;
      if ((KNOWN_FIELDS as readonly string[]).includes(target)) {
        fields[target] = value;
      } else if (target === TARGET_TAGS) {
        tags.push(...splitTags(value));
      } else if (target === TARGET_KIND) {
        kind = parseItemKind(value);
      }
    }

    if (!fields[FIELD_FRONT]?.trim() || !fields[FIELD_BACK]?.trim()) continue;

    // Kolejnosc kluczy ustalona, zeby te same dane dawaly identyczny rekord.
    const clean: Record<string, string> = {};
    for (const name of KNOWN_FIELDS) {
      if (fields[name]) clean[name] = fields[name];
    }

    drafts.push({
      fields: clean,
      tags: [...new Set(tags.filter(Boolean))].sort(),
      itemKind: kind ?? defaultKind ?? guessItemKind(clean[FIELD_FRONT]),
      sourceRef: row.sourceRef,
      sourceDeck: row.sourceDeck,
      noteType: row.noteType,
    });
  }

  const hashes = await Promise.all(drafts.map((draft) => contentHash(draft.fields)));
  return drafts.map((draft, i) => ({ ...draft, contentHash: hashes[i] }));
}

export function preview(drafts: NoteDraft[]): NoteDraft[] {
  return drafts.slice(0, PREVIEW_SIZE);
}

export interface DuplicateSummary {
  total: number;
  unique: number;
  duplicatesInFile: number;
  alreadyInCollection: number;
}

async function existingHashes(): Promise<Set<string>> {
  const database = await db();
  const notes = await database.getAll("notes");
  return new Set(notes.map((note) => note.contentHash));
}

/** Ile pozycji juz jest w bazie i ile powtarza sie w samym pliku. */
export async function duplicateSummary(drafts: NoteDraft[]): Promise<DuplicateSummary> {
  const hashes = drafts.map((draft) => draft.contentHash);
  const unique = new Set(hashes);
  const existing = await existingHashes();
  let alreadyInCollection = 0;
  for (const hash of unique) if (existing.has(hash)) alreadyInCollection += 1;
  return {
    total: drafts.length,
    unique: unique.size,
    duplicatesInFile: hashes.length - unique.size,
    alreadyInCollection,
  };
}

export interface CommitStats {
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
}

const CARDS_PER_NOTE_TYPE: Record<NoteType, number> = { basic: 1, basic_reversed: 2 };

/** Typ ze zrodla wygrywa z typem wybranym przy imporcie (talia bywa mieszana). */
function resolveNoteType(fromSource: NoteType | null, fallback: NoteType): NoteType {
  return fromSource ?? fallback;
}

/**
 * Tworzy notatki i karty jedna transakcja - import jest w calosci albo wcale.
 */
export async function commitImport(
  deckId: string,
  drafts: NoteDraft[],
  options: { noteType: NoteType; skipDuplicates?: boolean; now?: Date },
): Promise<CommitStats> {
  const now = options.now ?? new Date();
  const skipDuplicates = options.skipDuplicates ?? true;
  const iso = now.toISOString();

  const database = await db();
  const deck = await database.get("decks", deckId);
  if (!deck) throw new Error("Nie znaleziono talii");

  const existing = await existingHashes();
  const seenInBatch = new Set<string>();

  const notes: NoteRecord[] = [];
  const cards: CardRecord[] = [];
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const draft of drafts) {
    if (!draft.fields[FIELD_FRONT] || !draft.fields[FIELD_BACK]) {
      skippedInvalid += 1;
      continue;
    }
    if (skipDuplicates && (existing.has(draft.contentHash) || seenInBatch.has(draft.contentHash))) {
      skippedDuplicates += 1;
      continue;
    }
    seenInBatch.add(draft.contentHash);

    const noteType = resolveNoteType(draft.noteType, options.noteType);
    const note: NoteRecord = {
      id: crypto.randomUUID(),
      deckId,
      noteType,
      fields: draft.fields,
      tags: draft.tags,
      itemKind: draft.itemKind,
      sourceRef: draft.sourceRef,
      contentHash: draft.contentHash,
      createdAt: iso,
      updatedAt: iso,
    };
    notes.push(note);
    for (let ord = 0; ord < CARDS_PER_NOTE_TYPE[noteType]; ord += 1) {
      const snapshot = newCardSnapshot(now);
      cards.push({
        id: crypto.randomUUID(),
        noteId: note.id,
        deckId,
        templateOrd: ord as 0 | 1,
        fsrs: snapshot,
        due: snapshot.due,
        createdAt: iso,
        updatedAt: iso,
      });
    }
  }

  const tx = database.transaction(["notes", "cards"], "readwrite");
  for (const note of notes) await tx.objectStore("notes").put(note);
  for (const card of cards) await tx.objectStore("cards").put(card);
  await tx.done;

  return { imported: notes.length, skippedDuplicates, skippedInvalid };
}
