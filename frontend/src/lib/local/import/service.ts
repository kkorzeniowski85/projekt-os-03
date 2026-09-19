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
  /**
   * Czy kategoria pochodzi WPROST ze zrodla, czy zostala zgadnieta.
   *
   * Ma znaczenie przy aktualizacji istniejacych fiszek: zgadnieta kategoria
   * nie moze nadpisac tej, ktora uzytkownik ustawil recznie. Heurystyka nie
   * odrozni idiomu od zwyklej frazy, wiec ponowny import zepsulby recznie
   * poprawione "wyrazenie" na "fraze".
   */
  kindExplicit: boolean;
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
      // Kolumna zrodla albo jawny wybor przy imporcie to decyzja czlowieka;
      // heurystyka nie.
      kindExplicit: kind !== null || defaultKind != null,
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
  /** Uzupelnione istniejace fiszki (tryb "update"). */
  updated: number;
  skippedDuplicates: number;
  skippedInvalid: number;
}

/**
 * Co zrobic z pozycja, ktora juz jest w kolekcji (ten sam odcisk tresci).
 *
 * - `skip`   - pomin (domyslne; import tylko dokłada nowy material)
 * - `update` - uzupelnij istniejaca fiszke o to, co przynosi plik
 * - `add`    - dodaj mimo wszystko, jako osobna fiszke
 */
export type DuplicateMode = "skip" | "update" | "add";

const CARDS_PER_NOTE_TYPE: Record<NoteType, number> = { basic: 1, basic_reversed: 2 };

/** Typ ze zrodla wygrywa z typem wybranym przy imporcie (talia bywa mieszana). */
function resolveNoteType(fromSource: NoteType | null, fallback: NoteType): NoteType {
  return fromSource ?? fallback;
}

/**
 * Scala istniejaca fiszke z tym, co przynosi plik.
 *
 * Zasada: UZUPELNIA, nie kasuje. Brak wartosci w pliku nigdy nie usuwa tego,
 * co juz jest - ponowny import ubozszej wersji nie moze zubozyc kolekcji.
 *
 * `protectContent` - dla fiszki poprawionej recznie, gdy zrodlem jest
 * Slownik wbudowany: przod, tyl, przyklad i kategoria zostaja jej, dochodzi
 * tylko to, czego nie miala. Reka uzytkownika wygrywa z repozytorium.
 *
 * Czego NIE rusza: typu notatki. Zmiana typu zmienia liczbe kart, a to
 * znaczy skasowanie karty razem z jej stanem FSRS. Aktualizacja dotyczy
 * tresci, nigdy stanu nauki. Zmiane typu robi sie swiadomie przez "Edytuj".
 */
function mergeNote(
  existing: NoteRecord,
  draft: NoteDraft,
  iso: string,
  protectContent = false,
): NoteRecord {
  const fields = { ...existing.fields };
  for (const name of KNOWN_FIELDS) {
    const incoming = draft.fields[name]?.trim();
    if (!incoming) continue;
    if (protectContent && fields[name]) continue;
    fields[name] = incoming;
  }

  return {
    ...existing,
    fields,
    // Tagi sie sumuja - zadna etykieta nie ginie przy ponownym imporcie.
    tags: [...new Set([...existing.tags, ...draft.tags])].sort(),
    // Zgadnieta kategoria nie moze nadpisac recznie ustawionej.
    itemKind: draft.kindExplicit && !protectContent ? draft.itemKind : existing.itemKind,
    sourceRef: draft.sourceRef ?? existing.sourceRef,
    // Odcisk ma opisywac to, co faktycznie stoi w polach: po poprawce
    // tlumaczenia z pakietu jest nowy, przy chronionej tresci - bez zmian.
    contentHash: protectContent ? existing.contentHash : draft.contentHash,
    updatedAt: iso,
  };
}

/** Czy scalenie cokolwiek zmienilo - bez tego liczylibysmy puste zapisy. */
function differs(before: NoteRecord, after: NoteRecord): boolean {
  return (
    JSON.stringify(before.fields) !== JSON.stringify(after.fields) ||
    before.tags.join("") !== after.tags.join("") ||
    before.itemKind !== after.itemKind ||
    before.sourceRef !== after.sourceRef ||
    before.contentHash !== after.contentHash
  );
}

/**
 * Tworzy notatki i karty jedna transakcja - import jest w calosci albo wcale.
 */
export async function commitImport(
  deckId: string,
  drafts: NoteDraft[],
  options: {
    noteType: NoteType;
    /** Domyslnie "skip". `skipDuplicates: false` zostaje jako alias "add". */
    onDuplicate?: DuplicateMode;
    skipDuplicates?: boolean;
    now?: Date;
    /**
     * Zrodlem jest Slownik wbudowany: fiszke odnajdujemy takze po sourceRef
     * i - jesli uzytkownik jej nie poprawial - wersja z pakietu wygrywa.
     * Wymusza tryb "update".
     */
    authoritative?: boolean;
  },
): Promise<CommitStats> {
  const now = options.now ?? new Date();
  const authoritative = options.authoritative === true;
  const mode: DuplicateMode = authoritative
    ? "update"
    : (options.onDuplicate ?? (options.skipDuplicates === false ? "add" : "skip"));
  const iso = now.toISOString();

  const database = await db();
  const deck = await database.get("decks", deckId);
  if (!deck) throw new Error("Nie znaleziono talii");

  // Przy aktualizacji potrzebujemy calych rekordow, nie samych odciskow.
  const byHash = new Map<string, NoteRecord>();
  // Pakiet odnajduje fiszke takze po sourceRef: poprawka tlumaczenia zmienia
  // odcisk, a ma trafic w te sama fiszke, nie utworzyc drugiej obok.
  const bySourceRef = new Map<string, NoteRecord>();
  for (const note of await database.getAll("notes")) {
    if (!byHash.has(note.contentHash)) byHash.set(note.contentHash, note);
    if (authoritative && note.sourceRef && !bySourceRef.has(note.sourceRef)) {
      bySourceRef.set(note.sourceRef, note);
    }
  }
  const seenInBatch = new Set<string>();

  const notes: NoteRecord[] = [];
  const cards: CardRecord[] = [];
  const updates: NoteRecord[] = [];
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  // Kolejne pozycje dostaja rosnacy znacznik czasu (co milisekunde). Kolejka
  // nauki porzadkuje nowe karty wlasnie po nim, wiec bez tego caly import
  // mialby jeden czas i kolejnosc ulozona przez autora talii przepadalaby
  // na rzecz przypadkowej. Roznica milisekund jest zgodna z prawda: notatki
  // powstaja jedna po drugiej.
  let offset = 0;

  for (const draft of drafts) {
    if (!draft.fields[FIELD_FRONT] || !draft.fields[FIELD_BACK]) {
      skippedInvalid += 1;
      continue;
    }
    const known =
      byHash.get(draft.contentHash) ??
      (authoritative && draft.sourceRef ? bySourceRef.get(draft.sourceRef) : undefined);
    const duplicate = known !== undefined || seenInBatch.has(draft.contentHash);

    if (duplicate && mode !== "add") {
      // Powtorzenie w samym pliku zawsze pomijamy - nie ma czego aktualizowac
      // rekordem, ktory dopiero powstaje w tej samej transakcji.
      if (mode === "update" && known) {
        // Reka uzytkownika wygrywa z pakietem; plik z importu uzupelnia jak dotad.
        const merged = mergeNote(known, draft, iso, authoritative && Boolean(known.editedAt));
        if (differs(known, merged)) {
          updates.push(merged);
          // Kolejne powtorzenia maja widziec nowy stan - takze pod nowym
          // odciskiem, gdy tresc sie zmienila.
          byHash.delete(known.contentHash);
          byHash.set(merged.contentHash, merged);
          if (merged.sourceRef) bySourceRef.set(merged.sourceRef, merged);
        } else {
          skippedDuplicates += 1;
        }
      } else {
        skippedDuplicates += 1;
      }
      continue;
    }
    seenInBatch.add(draft.contentHash);

    const noteType = resolveNoteType(draft.noteType, options.noteType);
    const stamp = new Date(now.getTime() + offset).toISOString();
    offset += 1;

    const note: NoteRecord = {
      id: crypto.randomUUID(),
      deckId,
      noteType,
      fields: draft.fields,
      tags: draft.tags,
      itemKind: draft.itemKind,
      sourceRef: draft.sourceRef,
      contentHash: draft.contentHash,
      createdAt: stamp,
      updatedAt: stamp,
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
        createdAt: stamp,
        updatedAt: stamp,
      });
    }
  }

  const tx = database.transaction(["notes", "cards"], "readwrite");
  for (const note of notes) await tx.objectStore("notes").put(note);
  for (const note of updates) await tx.objectStore("notes").put(note);
  for (const card of cards) await tx.objectStore("cards").put(card);
  await tx.done;

  return {
    imported: notes.length,
    updated: updates.length,
    skippedDuplicates,
    skippedInvalid,
  };
}
