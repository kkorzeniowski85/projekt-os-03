/**
 * Operacje na danych lokalnych - odpowiednik backendowych endpointow
 * decks / notes / study. Ekrany rozmawiaja z tym modulem, nie z IndexedDB.
 */

import type { ItemKind, NoteType, Rating } from "@/lib/types";

import { contentHash, FIELD_BACK, FIELD_FRONT, guessItemKind, KNOWN_FIELDS } from "./content";
import { db } from "./db";
import {
  applyReview,
  isNew,
  makeScheduler,
  newCardSnapshot,
  schedulerVersion,
} from "./scheduler";
import { dayStart } from "./time";
import type {
  CardRecord,
  DeckRecord,
  NoteRecord,
  ReviewLogRecord,
  SettingsRecord,
} from "./types";

const CARDS_PER_NOTE_TYPE: Record<NoteType, number> = { basic: 1, basic_reversed: 2 };

const uid = () => crypto.randomUUID();

// --- ustawienia ------------------------------------------------------------

export async function getSettings(): Promise<SettingsRecord> {
  const database = await db();
  const existing = await database.get("settings", "app");
  if (existing) return existing;
  const iso = new Date().toISOString();
  const created: SettingsRecord = {
    id: "app",
    desiredRetention: 0.9,
    fsrsParameters: null,
    createdAt: iso,
    updatedAt: iso,
  };
  await database.put("settings", created);
  return created;
}

// --- talie -----------------------------------------------------------------

export interface DeckCounts {
  new: number;
  due: number;
  total: number;
}

export async function createDeck(
  input: { name: string; description?: string },
  now: Date = new Date(),
): Promise<DeckRecord> {
  const name = input.name.trim();
  if (!name) throw new Error("Talia musi miec nazwe");

  const database = await db();
  const all = await database.getAll("decks");
  if (all.some((deck) => deck.name === name)) {
    throw new Error(`Talia "${name}" juz istnieje`);
  }

  const iso = now.toISOString();
  const deck: DeckRecord = {
    id: uid(),
    name,
    description: (input.description ?? "").trim(),
    newPerDay: 20,
    maxReviewsPerDay: 200,
    createdAt: iso,
    updatedAt: iso,
  };
  await database.put("decks", deck);
  return deck;
}

export async function updateDeck(
  id: string,
  patch: Partial<Pick<DeckRecord, "name" | "description" | "newPerDay" | "maxReviewsPerDay">>,
): Promise<DeckRecord> {
  const database = await db();
  const deck = await database.get("decks", id);
  if (!deck) throw new Error("Nie znaleziono talii");

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Talia musi miec nazwe");
    const all = await database.getAll("decks");
    if (all.some((other) => other.id !== id && other.name === name)) {
      throw new Error(`Talia "${name}" juz istnieje`);
    }
    deck.name = name;
  }
  if (patch.description !== undefined) deck.description = patch.description.trim();
  if (patch.newPerDay !== undefined) deck.newPerDay = Math.max(0, patch.newPerDay);
  if (patch.maxReviewsPerDay !== undefined) {
    deck.maxReviewsPerDay = Math.max(0, patch.maxReviewsPerDay);
  }
  deck.updatedAt = new Date().toISOString();
  await database.put("decks", deck);
  return deck;
}

export async function getDeck(id: string): Promise<DeckRecord> {
  const deck = await (await db()).get("decks", id);
  if (!deck) throw new Error("Nie znaleziono talii");
  return deck;
}

export async function listDecks(
  now: Date = new Date(),
): Promise<Array<DeckRecord & { counts: DeckCounts }>> {
  const database = await db();
  const decks = await database.getAll("decks");
  const nowIso = now.toISOString();

  const out = [];
  for (const deck of decks.sort((a, b) => a.name.localeCompare(b.name, "pl"))) {
    const cards = await database.getAllFromIndex("cards", "by-deck", deck.id);
    const counts: DeckCounts = { new: 0, due: 0, total: cards.length };
    for (const card of cards) {
      if (isNew(card.fsrs)) counts.new += 1;
      else if (card.due <= nowIso) counts.due += 1;
    }
    out.push({ ...deck, counts });
  }
  return out;
}

/** Kasuje talie z notatkami i kartami. Log powtorek zostaje (ADR 0006). */
export async function deleteDeck(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["decks", "notes", "cards"], "readwrite");
  const notes = await tx.objectStore("notes").index("by-deck").getAllKeys(id);
  const cards = await tx.objectStore("cards").index("by-deck").getAllKeys(id);
  for (const key of cards) await tx.objectStore("cards").delete(key);
  for (const key of notes) await tx.objectStore("notes").delete(key);
  await tx.objectStore("decks").delete(id);
  await tx.done;
}

// --- notatki i karty -------------------------------------------------------

export interface NoteDraftInput {
  deckId: string;
  noteType: NoteType;
  fields: Record<string, string>;
  tags?: string[];
  /** Brak = zgadywanie z tresci przodu. EXPRESSION trzeba podac wprost. */
  itemKind?: ItemKind;
  sourceRef?: string | null;
}

function cleanFields(raw: Record<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const name of KNOWN_FIELDS) {
    const value = (raw[name] ?? "").trim();
    if (value) fields[name] = value;
  }
  return fields;
}

function buildCards(note: NoteRecord, now: Date): CardRecord[] {
  const iso = now.toISOString();
  return Array.from({ length: CARDS_PER_NOTE_TYPE[note.noteType] }, (_, ord) => {
    const snapshot = newCardSnapshot(now);
    return {
      id: uid(),
      noteId: note.id,
      deckId: note.deckId,
      templateOrd: ord as 0 | 1,
      fsrs: snapshot,
      due: snapshot.due,
      createdAt: iso,
      updatedAt: iso,
    };
  });
}

export async function createNote(
  input: NoteDraftInput,
  now: Date = new Date(),
): Promise<{ note: NoteRecord; cards: CardRecord[] }> {
  const fields = cleanFields(input.fields);
  if (!fields[FIELD_FRONT] || !fields[FIELD_BACK]) {
    throw new Error("Notatka musi miec przod i tyl");
  }

  const database = await db();
  const deck = await database.get("decks", input.deckId);
  if (!deck) throw new Error("Nie znaleziono talii");

  const hash = await contentHash(fields);
  const iso = now.toISOString();
  const note: NoteRecord = {
    id: uid(),
    deckId: input.deckId,
    noteType: input.noteType,
    fields,
    tags: [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))].sort(),
    itemKind: input.itemKind ?? guessItemKind(fields[FIELD_FRONT]),
    sourceRef: input.sourceRef ?? null,
    contentHash: hash,
    createdAt: iso,
    updatedAt: iso,
  };
  const cards = buildCards(note, now);

  const tx = database.transaction(["notes", "cards"], "readwrite");
  await tx.objectStore("notes").put(note);
  for (const card of cards) await tx.objectStore("cards").put(card);
  await tx.done;

  return { note, cards };
}

export async function findDuplicateByHash(hash: string): Promise<NoteRecord | undefined> {
  const database = await db();
  return database.getFromIndex("notes", "by-hash", hash);
}

export async function listNotes(
  deckId: string,
): Promise<Array<{ note: NoteRecord; cards: CardRecord[] }>> {
  const database = await db();
  const notes = await database.getAllFromIndex("notes", "by-deck", deckId);
  const out = [];
  for (const note of notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const cards = await database.getAllFromIndex("cards", "by-note", note.id);
    out.push({ note, cards: cards.sort((a, b) => a.templateOrd - b.templateOrd) });
  }
  return out;
}

export async function updateNote(
  id: string,
  patch: {
    fields?: Record<string, string>;
    tags?: string[];
    itemKind?: ItemKind;
    noteType?: NoteType;
  },
  now: Date = new Date(),
): Promise<NoteRecord> {
  const database = await db();
  const note = await database.get("notes", id);
  if (!note) throw new Error("Nie znaleziono notatki");

  if (patch.fields !== undefined) {
    const fields = cleanFields(patch.fields);
    if (!fields[FIELD_FRONT] || !fields[FIELD_BACK]) {
      throw new Error("Notatka musi miec przod i tyl");
    }
    note.fields = fields;
    note.contentHash = await contentHash(fields);
  }
  if (patch.tags !== undefined) {
    note.tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))].sort();
  }
  if (patch.itemKind !== undefined) note.itemKind = patch.itemKind;
  if (patch.noteType !== undefined) note.noteType = patch.noteType;
  note.updatedAt = now.toISOString();

  const tx = database.transaction(["notes", "cards"], "readwrite");
  await tx.objectStore("notes").put(note);

  // Dosztukowanie/usuniecie kart przy zmianie typu. Kasowana karta zabiera
  // swoj stan FSRS - historia zostaje w logu (denormalizacja, ADR 0006).
  const target = CARDS_PER_NOTE_TYPE[note.noteType];
  const existing = (await tx.objectStore("cards").index("by-note").getAll(id)).sort(
    (a, b) => a.templateOrd - b.templateOrd,
  );
  for (const card of existing.slice(target)) {
    await tx.objectStore("cards").delete(card.id);
  }
  for (let ord = existing.length; ord < target; ord += 1) {
    const snapshot = newCardSnapshot(now);
    await tx.objectStore("cards").put({
      id: uid(),
      noteId: note.id,
      deckId: note.deckId,
      templateOrd: ord as 0 | 1,
      fsrs: snapshot,
      due: snapshot.due,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
  await tx.done;
  return note;
}

export async function deleteNote(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["notes", "cards"], "readwrite");
  const cards = await tx.objectStore("cards").index("by-note").getAllKeys(id);
  for (const key of cards) await tx.objectStore("cards").delete(key);
  await tx.objectStore("notes").delete(id);
  await tx.done;
}

// --- kolejka nauki ---------------------------------------------------------

export interface StudyQueueResult {
  deckId: string;
  cards: Array<{ card: CardRecord; note: NoteRecord }>;
  newRemaining: number;
  dueRemaining: number;
}

export async function studyQueue(
  deckId: string,
  options?: { limit?: number; now?: Date },
): Promise<StudyQueueResult> {
  const limit = options?.limit ?? 20;
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();

  const database = await db();
  const deck = await database.get("decks", deckId);
  if (!deck) throw new Error("Nie znaleziono talii");

  // Dzisiejsze liczniki z logu: powtorki ogolem oraz karty widziane dzis po
  // raz pierwszy (stateBefore.state === New) - jak w backendzie.
  const since = dayStart(now).toISOString();
  const today = await database.getAllFromIndex(
    "reviewLog",
    "by-deck-time",
    IDBKeyRange.bound([deckId, since], [deckId, "￿"]),
  );
  const reviewsToday = today.length;
  const newToday = new Set(
    today.filter((entry) => entry.stateBefore.state === 0).map((entry) => entry.cardId),
  ).size;

  const newAllowance = Math.max(deck.newPerDay - newToday, 0);
  const reviewAllowance = Math.max(deck.maxReviewsPerDay - reviewsToday, 0);

  // Zalegle: widziane (state != New) z terminem, ktory minal. Indeks zwraca
  // je posortowane po due.
  const dueAll = (
    await database.getAllFromIndex(
      "cards",
      "by-deck-due",
      IDBKeyRange.bound([deckId, ""], [deckId, nowIso]),
    )
  ).filter((card) => !isNew(card.fsrs));
  const due = dueAll.slice(0, Math.min(limit, reviewAllowance));

  // Nowe: nigdy nie widziane, w kolejnosci dodania.
  const newAll = (await database.getAllFromIndex("cards", "by-deck", deckId))
    .filter((card) => isNew(card.fsrs))
    .sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.templateOrd - b.templateOrd,
    );
  const slots = Math.max(limit - due.length, 0);
  const fresh = newAll.slice(0, Math.min(slots, newAllowance));

  const notes = new Map<string, NoteRecord>();
  const joined = [];
  for (const card of [...due, ...fresh]) {
    if (!notes.has(card.noteId)) {
      const note = await database.get("notes", card.noteId);
      if (!note) continue; // osierocona karta - nie wysadzaj kolejki
      notes.set(card.noteId, note);
    }
    joined.push({ card, note: notes.get(card.noteId)! });
  }

  return {
    deckId,
    cards: joined,
    newRemaining: Math.min(newAll.length, newAllowance),
    dueRemaining: Math.min(dueAll.length, reviewAllowance),
  };
}

// --- ocena -----------------------------------------------------------------

export interface ReviewInput {
  cardId: string;
  rating: Rating;
  /** Czas odpowiedzi. Wymagany (ADR 0005). */
  durationMs: number;
  now?: Date;
}

export async function submitReview(
  input: ReviewInput,
): Promise<{ card: CardRecord; log: ReviewLogRecord }> {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new Error("Brak czasu odpowiedzi (durationMs)");
  }
  const now = input.now ?? new Date();
  const settings = await getSettings();
  const scheduler = makeScheduler(settings);

  const database = await db();
  const tx = database.transaction(["cards", "notes", "reviewLog"], "readwrite");
  const card = await tx.objectStore("cards").get(input.cardId);
  if (!card) {
    tx.abort();
    throw new Error("Nie znaleziono karty");
  }
  const note = await tx.objectStore("notes").get(card.noteId);

  const stateBefore = card.fsrs;
  const stateAfter = applyReview(scheduler, stateBefore, input.rating, now);

  const updated: CardRecord = {
    ...card,
    fsrs: stateAfter,
    due: stateAfter.due,
    updatedAt: now.toISOString(),
  };
  const log: ReviewLogRecord = {
    id: uid(),
    cardId: card.id,
    deckId: card.deckId,
    itemKind: note?.itemKind ?? "other",
    rating: input.rating,
    reviewDatetime: now.toISOString(),
    durationMs: Math.round(input.durationMs),
    stateBefore,
    stateAfter,
    scheduler: schedulerVersion(settings),
  };

  await tx.objectStore("cards").put(updated);
  await tx.objectStore("reviewLog").put(log);
  await tx.done;

  return { card: updated, log };
}
