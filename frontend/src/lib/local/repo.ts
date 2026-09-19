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
import { BUNDLED_STATE_ID, asBundledState } from "./bundled-state";

const CARDS_PER_NOTE_TYPE: Record<NoteType, number> = { basic: 1, basic_reversed: 2 };

const uid = () => crypto.randomUUID();

// --- ustawienia ------------------------------------------------------------

export async function getSettings(): Promise<SettingsRecord> {
  const database = await db();
  const existing = await database.get("settings", "app");
  if (existing && existing.id === "app") return existing;
  const iso = new Date().toISOString();
  const created: SettingsRecord = {
    id: "app",
    desiredRetention: 0.9,
    examDate: null,
    fsrsParameters: null,
    createdAt: iso,
    updatedAt: iso,
  };
  await database.put("settings", created);
  return created;
}

export async function updateSettings(
  patch: Partial<Pick<SettingsRecord, "desiredRetention" | "examDate" | "fsrsParameters">>,
  now: Date = new Date(),
): Promise<SettingsRecord> {
  const current = await getSettings();
  const next: SettingsRecord = { ...current, ...patch, updatedAt: now.toISOString() };
  const database = await db();
  await database.put("settings", next);
  return next;
}

// --- talie -----------------------------------------------------------------

export interface DeckCounts {
  new: number;
  due: number;
  total: number;
}

// --- Slownik: baza glowna ---------------------------------------------------
//
// Centralne miejsce na caly material. Import z zewnatrz i talie generowane
// przez Claude'a trafiaja tu domyslnie, zamiast mnozyc osobne grupy. Osobna
// talia to swiadomy wybor, nie efekt uboczny wgrania pliku.
//
// Identyfikator jest staly (nie UUID): dzieki temu ochrona przed skasowaniem
// nie zalezy od niczego poza id, a Slownik odtworzony po przywroceniu starej
// kopii to wciaz "ten sam" Slownik.

export const DICTIONARY_DECK_ID = "slownik";
export const DICTIONARY_NAME = "Słownik";

export function isDictionary(deckId: string): boolean {
  return deckId === DICTIONARY_DECK_ID;
}

/** Zwraca Slownik, tworzac go przy pierwszym uzyciu. */
export async function ensureDictionary(now: Date = new Date()): Promise<DeckRecord> {
  const database = await db();
  const existing = await database.get("decks", DICTIONARY_DECK_ID);
  if (existing) return existing;
  const iso = now.toISOString();
  const deck: DeckRecord = {
    id: DICTIONARY_DECK_ID,
    name: DICTIONARY_NAME,
    description: "Baza główna — tu trafia materiał z importu.",
    newPerDay: 20,
    maxReviewsPerDay: 200,
    createdAt: iso,
    updatedAt: iso,
  };
  await database.put("decks", deck);
  return deck;
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
  // Slownik zawsze na poczatku - to baza glowna, reszta alfabetycznie.
  const sorted = decks.sort(
    (a, b) =>
      Number(isDictionary(b.id)) - Number(isDictionary(a.id)) ||
      a.name.localeCompare(b.name, "pl"),
  );
  for (const deck of sorted) {
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
  if (isDictionary(id)) {
    // Nienaruszalnosc bazy glownej: kasowac mozna pojedyncze fiszki, nigdy
    // calosc. Ta linia ma chronic takze przed przyszlym kodem, nie tylko
    // przed dzisiejszym interfejsem.
    throw new Error("Słownik jest bazą główną i nie można go usunąć — kasuj pojedyncze fiszki");
  }
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
    // Fiszka dopisana recznie jest tak samo "autorska" jak poprawiona
    // recznie - Slownik wbudowany nie moze jej nadpisac.
    editedAt: iso,
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
  // Jeden odczyt kart calej talii zamiast jednego na notatke - lista
  // Slownika to setki notatek, a kazdy odczyt to osobna transakcja.
  const cardsByNote = new Map<string, CardRecord[]>();
  for (const card of await database.getAllFromIndex("cards", "by-deck", deckId)) {
    const list = cardsByNote.get(card.noteId);
    if (list) list.push(card);
    else cardsByNote.set(card.noteId, [card]);
  }
  return notes
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((note) => ({
      note,
      cards: (cardsByNote.get(note.id) ?? []).sort((a, b) => a.templateOrd - b.templateOrd),
    }));
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
  const contentBefore = JSON.stringify([note.fields, note.tags, note.itemKind]);

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
  // Slad reki uzytkownika: od tej pory Slownik wbudowany tej fiszki nie
  // nadpisuje, tylko dopisuje braki. Tylko gdy tresc naprawde sie zmienila -
  // samo przelaczenie typu (formularz odsyla pola bez zmian) nie moze
  // na zawsze odciac fiszki od poprawek z pakietu.
  if (JSON.stringify([note.fields, note.tags, note.itemKind]) !== contentBefore) {
    note.editedAt = now.toISOString();
  }

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

/**
 * Kasuje notatke z kartami i - gdy to material z pakietu - zapamietuje,
 * ze zostala odrzucona RECZNIE.
 *
 * Bez tego sladu Slownik wbudowany przywrocilby ja przy nastepnej
 * aktualizacji - skasowanie ma byc decyzja ostateczna.
 *
 * Slad zostawiamy waziutko: tylko dla fiszek ze Slownika, ktore maja
 * sourceRef, i tylko pod tym identyfikatorem. Szerszy zapis szkodzil:
 * odcisk tresci blokowal przyszla pozycje pakietu o tym samym przodzie
 * i tyle, ktorej uzytkownik nigdy nie widzial, a kasowanie w dowolnej
 * talii (choćby roboczej) liczylo sie jak odrzucenie materialu.
 * Kasowanie calej talii sladu nie zostawia - to porzadkowanie, nie sad
 * o pojedynczej fiszce.
 */
export async function deleteNote(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["notes", "cards", "settings"], "readwrite");
  const note = await tx.objectStore("notes").get(id);
  const cards = await tx.objectStore("cards").index("by-note").getAllKeys(id);
  for (const key of cards) await tx.objectStore("cards").delete(key);
  await tx.objectStore("notes").delete(id);
  if (note?.sourceRef && isDictionary(note.deckId)) {
    const settings = tx.objectStore("settings");
    const state = asBundledState(await settings.get(BUNDLED_STATE_ID));
    const removed = new Set(state.removed);
    removed.add(note.sourceRef);
    await settings.put({ ...state, removed: [...removed] });
  }
  await tx.done;
}

/**
 * Odklada karte na bok albo przywraca ja do kolejki.
 *
 * Stan FSRS i historia zostaja nietkniete - to nie jest skasowanie, tylko
 * wyciszenie. Karta odlozona wraca dokladnie tam, gdzie byla.
 */
export async function setCardSuspended(
  cardId: string,
  suspended: boolean,
  now: Date = new Date(),
): Promise<CardRecord> {
  const database = await db();
  const card = await database.get("cards", cardId);
  if (!card) throw new Error("Nie znaleziono karty");
  const updated: CardRecord = { ...card, suspended, updatedAt: now.toISOString() };
  if (!suspended) delete updated.suspended;
  await database.put("cards", updated);
  return updated;
}

/** Odklada na bok wszystkie karty notatki - "tego juz nie chce widziec". */
export async function setNoteSuspended(
  noteId: string,
  suspended: boolean,
  now: Date = new Date(),
): Promise<number> {
  const database = await db();
  const tx = database.transaction("cards", "readwrite");
  const cards = await tx.store.index("by-note").getAll(noteId);
  for (const card of cards) {
    const updated: CardRecord = { ...card, suspended, updatedAt: now.toISOString() };
    if (!suspended) delete updated.suspended;
    await tx.store.put(updated);
  }
  await tx.done;
  return cards.length;
}

// --- laczenie talii ---------------------------------------------------------

export interface MergeResult {
  /** Talia, ktora zostala. */
  deckId: string;
  deckName: string;
  movedNotes: number;
  movedCards: number;
  movedReviews: number;
  removedDecks: number;
  /** Ile przeniesionych fiszek ma tresc juz obecna w talii docelowej. */
  duplicates: number;
}

/**
 * Przenosi cala zawartosc talii zrodlowych do docelowej i kasuje puste
 * zrodla. Stan powtorek kazdej karty zostaje nietkniety.
 *
 * Historia w logu takze jest przepinana na talie docelowa. Bez tego
 * statystyki scalonej talii nie objelyby nauki sprzed polaczenia - liczyly by
 * sie do talii, ktora juz nie istnieje. To jedyne miejsce, gdzie ruszamy
 * zapisany log; kategoria materialu w logu zostaje bez zmian.
 *
 * Duplikaty tresci sa PRZENOSZONE, nie kasowane - tylko policzone. Karta ma
 * wlasny stan nauki, a wybor "ktora wersje zachowac" nalezy do uzytkownika,
 * nie do funkcji laczacej talie.
 */
export async function mergeDecks(
  targetId: string,
  sourceIds: string[],
  now: Date = new Date(),
): Promise<MergeResult> {
  const sources = sourceIds.filter((id) => id !== targetId);
  if (sources.length === 0) throw new Error("Wskaz co najmniej jedna inna talie do polaczenia");
  if (sources.some(isDictionary)) {
    // Laczenie kasuje talie zrodlowe - a Slownik zniknac nie moze. W druga
    // strone wolno zawsze: wchlanianie talii do Slownika to wlasnie glowny
    // sposob "znikania osobnych czesci" w bazie glownej.
    throw new Error("Słownik nie może zniknąć — wybierz go jako talię docelową");
  }

  const database = await db();
  const target = await database.get("decks", targetId);
  if (!target) throw new Error("Nie znaleziono talii docelowej");

  const iso = now.toISOString();
  const tx = database.transaction(["decks", "notes", "cards", "reviewLog"], "readwrite");

  const existingHashes = new Set(
    (await tx.objectStore("notes").index("by-deck").getAll(targetId)).map((n) => n.contentHash),
  );

  let movedNotes = 0;
  let movedCards = 0;
  let movedReviews = 0;
  let duplicates = 0;
  let removedDecks = 0;

  for (const sourceId of sources) {
    const deck = await tx.objectStore("decks").get(sourceId);
    if (!deck) continue;

    for (const note of await tx.objectStore("notes").index("by-deck").getAll(sourceId)) {
      if (existingHashes.has(note.contentHash)) duplicates += 1;
      else existingHashes.add(note.contentHash);
      await tx.objectStore("notes").put({ ...note, deckId: targetId, updatedAt: iso });
      movedNotes += 1;
    }

    for (const card of await tx.objectStore("cards").index("by-deck").getAll(sourceId)) {
      await tx.objectStore("cards").put({ ...card, deckId: targetId, updatedAt: iso });
      movedCards += 1;
    }

    for (const entry of await tx.objectStore("reviewLog").index("by-deck-time").getAll(
      IDBKeyRange.bound([sourceId, ""], [sourceId, "￿"]),
    )) {
      await tx.objectStore("reviewLog").put({ ...entry, deckId: targetId });
      movedReviews += 1;
    }

    await tx.objectStore("decks").delete(sourceId);
    removedDecks += 1;
  }

  await tx.objectStore("decks").put({ ...target, updatedAt: iso });
  await tx.done;

  return {
    deckId: targetId,
    deckName: target.name,
    movedNotes,
    movedCards,
    movedReviews,
    removedDecks,
    duplicates,
  };
}

// --- kolejka nauki ---------------------------------------------------------

/** Talie do nauki: jedna, kilka wybranych albo wszystkie. */
export type DeckSelection = string | string[] | "all";

export interface StudyQueueEntry {
  card: CardRecord;
  note: NoteRecord;
  /** Nazwa talii - przy nauce z kilku talii warto wiedziec, skad karta. */
  deckName: string;
}

export interface StudyQueueResult {
  deckIds: string[];
  cards: StudyQueueEntry[];
  newRemaining: number;
  dueRemaining: number;
}

export async function resolveDecks(selection: DeckSelection): Promise<DeckRecord[]> {
  const database = await db();
  if (selection === "all") {
    return (await database.getAll("decks")).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  }
  const ids = Array.isArray(selection) ? selection : [selection];
  const decks: DeckRecord[] = [];
  for (const id of ids) {
    const deck = await database.get("decks", id);
    if (deck) decks.push(deck);
  }
  if (decks.length === 0) throw new Error("Nie znaleziono talii");
  return decks;
}

/**
 * Kolejka nauki dla jednej talii, kilku wybranych albo wszystkich.
 *
 * Limity dzienne sa liczone OSOBNO dla kazdej talii, bo do niej naleza -
 * wspolna kolejka nie moze pozwolic, zeby jedna talia zjadla dzienny przydzial
 * nowych kart innej. Dopiero to, co przeszlo przez limity, jest mieszane
 * w jeden strumien: zalegle wg terminu, nowe wg kolejnosci dodania.
 */
export async function studyQueue(
  selection: DeckSelection,
  options?: { limit?: number; now?: Date; burySiblings?: boolean },
): Promise<StudyQueueResult> {
  const limit = options?.limit ?? 20;
  const bury = options?.burySiblings ?? true;
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();
  const since = dayStart(now).toISOString();

  const database = await db();
  const decks = await resolveDecks(selection);

  const dueParts: CardRecord[] = [];
  const newParts: CardRecord[] = [];
  let newRemaining = 0;
  let dueRemaining = 0;

  for (const deck of decks) {
    // Dzisiejsze liczniki z logu: powtorki ogolem oraz karty widziane dzis
    // po raz pierwszy (stateBefore.state === New).
    const today = await database.getAllFromIndex(
      "reviewLog",
      "by-deck-time",
      IDBKeyRange.bound([deck.id, since], [deck.id, "￿"]),
    );
    const newToday = new Set(
      today.filter((entry) => entry.stateBefore.state === 0).map((entry) => entry.cardId),
    ).size;
    const ocenioneDzis = new Set(today.map((entry) => entry.cardId));

    const newAllowance = Math.max(deck.newPerDay - newToday, 0);
    const reviewAllowance = Math.max(deck.maxReviewsPerDay - today.length, 0);

    // Nowe czytamy z calej talii, nie z zakresu terminow: karta dodana
    // "w przyszlosci" wzgledem zegara sesji (cofniety czas) nie moze zniknac
    // z kolejki. Przy okazji mamy z czego zbudowac mape karta -> notatka.
    const wszystkie = await database.getAllFromIndex("cards", "by-deck", deck.id);

    // Zakopywanie rodzenstwa: obie strony tej samej fiszki w jednej sesji to
    // nie dwie proby, tylko jedna - odpowiedz z pierwszej wciaz siedzi
    // w pamieci roboczej, wiec druga zawyzalaby ocene i psula planowanie.
    // Zakopujemy RODZENSTWO karty juz ocenionej, nie ja sama: karta z ocena
    // "Znowu" ma wrocic za kilka minut zgodnie z algorytmem.
    const notatkiDzis = new Set(
      wszystkie.filter((card) => ocenioneDzis.has(card.id)).map((card) => card.noteId),
    );
    const czynna = (card: CardRecord) =>
      card.suspended !== true &&
      !(bury && notatkiDzis.has(card.noteId) && !ocenioneDzis.has(card.id));

    // Zalegle: widziane (state != New) z terminem, ktory minal.
    const dueAll = (
      await database.getAllFromIndex(
        "cards",
        "by-deck-due",
        IDBKeyRange.bound([deck.id, ""], [deck.id, nowIso]),
      )
    ).filter((card) => !isNew(card.fsrs) && czynna(card));

    const newAll = wszystkie
      .filter((card) => isNew(card.fsrs) && czynna(card))
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          a.templateOrd - b.templateOrd ||
          // Ostateczny rozjemca: bez niego karty o identycznym znaczniku
          // czasu wracaja w kolejnosci, w jakiej odda je baza - czyli
          // przypadkowej i zmiennej miedzy wywolaniami.
          a.id.localeCompare(b.id),
      );

    // Rodzenstwo odsiewamy PRZED limitem dziennym. Odwrotna kolejnosc
    // zabralaby polowe przydzialu na karty, ktore i tak nie wejda do sesji:
    // obie strony fiszki maja ten sam czas dodania, wiec stoja w kolejce
    // parami. "20 nowych dziennie" ma znaczyc 20 fiszek, nie 10.
    const jednaNaNotatke = (karty: CardRecord[], zajete: Set<string>) => {
      if (!bury) return karty;
      const wynik: CardRecord[] = [];
      for (const card of karty) {
        if (zajete.has(card.noteId)) continue;
        zajete.add(card.noteId);
        wynik.push(card);
      }
      return wynik;
    };
    const zajeteWTalii = new Set<string>();
    const dueWybrane = jednaNaNotatke(dueAll, zajeteWTalii);
    const newWybrane = jednaNaNotatke(newAll, zajeteWTalii);

    dueParts.push(...dueWybrane.slice(0, reviewAllowance));
    newParts.push(...newWybrane.slice(0, newAllowance));
    dueRemaining += Math.min(dueWybrane.length, reviewAllowance);
    newRemaining += Math.min(newWybrane.length, newAllowance);
  }

  // Zalegle: wg terminu - najstarszy dlug pierwszy, niezaleznie od talii.
  dueParts.sort((a, b) => a.due.localeCompare(b.due));

  // Nowe: PRZEPLATANE miedzy taliami, nie sortowane globalnie po dacie
  // dodania. Import idzie talia po talii, wiec globalne sortowanie ustawia
  // kolejke w bloki i "wspolna kolejka" niczym nie rozni sie od nauki po
  // kolei. W obrebie jednej talii kolejnosc dodania zostaje zachowana.
  const byDeck = decks.map((deck) =>
    newParts
      .filter((card) => card.deckId === deck.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.templateOrd - b.templateOrd),
  );
  const interleaved: CardRecord[] = [];
  const longest = Math.max(0, ...byDeck.map((cards) => cards.length));
  for (let i = 0; i < longest; i += 1) {
    for (const cards of byDeck) {
      if (i < cards.length) interleaved.push(cards[i]);
    }
  }

  const chosen = [...dueParts, ...interleaved].slice(0, limit);

  const deckNames = new Map(decks.map((deck) => [deck.id, deck.name]));
  const notes = new Map<string, NoteRecord>();
  const joined: StudyQueueEntry[] = [];
  for (const card of chosen) {
    if (!notes.has(card.noteId)) {
      const note = await database.get("notes", card.noteId);
      if (!note) continue; // osierocona karta - nie wysadzaj kolejki
      notes.set(card.noteId, note);
    }
    joined.push({
      card,
      note: notes.get(card.noteId)!,
      deckName: deckNames.get(card.deckId) ?? "",
    });
  }

  return {
    deckIds: decks.map((deck) => deck.id),
    cards: joined,
    newRemaining,
    dueRemaining,
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

/**
 * Cofa ostatnia ocene: karta wraca do stanu sprzed niej, wpis znika z logu.
 *
 * Potrzebne, bo na telefonie kciuk trafia w sasiedni przycisk, a bledna ocena
 * przesuwa termin o tygodnie. Cofamy tylko OSTATNIA ocene i tylko wtedy, gdy
 * karta nie byla pozniej oceniana ponownie - inaczej przywrocilibysmy stan
 * sprzed cudzej, wazniejszej zmiany.
 *
 * Log jest append-only wszedzie indziej (ADR 0005); to jedyne odstepstwo,
 * swiadome: wpis, ktory nie opisuje prawdziwej proby, zafalszowalby
 * statystyki bardziej niz jego brak.
 */
export async function undoLastReview(): Promise<{ card: CardRecord; note: NoteRecord } | null> {
  const database = await db();
  const tx = database.transaction(["cards", "notes", "reviewLog"], "readwrite");
  const log = tx.objectStore("reviewLog");

  // Ostatni wpis wg czasu - kursor od konca indeksu.
  const kursor = await log.index("by-time").openCursor(null, "prev");
  if (!kursor) {
    await tx.done;
    return null;
  }
  const wpis = kursor.value;
  const card = await tx.objectStore("cards").get(wpis.cardId);
  if (!card) {
    await tx.done;
    return null;
  }

  const przywrocona: CardRecord = {
    ...card,
    fsrs: wpis.stateBefore,
    due: wpis.stateBefore.due,
    updatedAt: new Date().toISOString(),
  };
  await tx.objectStore("cards").put(przywrocona);
  await log.delete(wpis.id);
  const note = await tx.objectStore("notes").get(card.noteId);
  await tx.done;

  return note ? { card: przywrocona, note } : null;
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
