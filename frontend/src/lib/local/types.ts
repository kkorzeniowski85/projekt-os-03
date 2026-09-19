/**
 * Rekordy warstwy lokalnej (IndexedDB).
 *
 * Daty trzymamy jako ISO string, nie Date: indeksy IndexedDB sortuja ISO
 * poprawnie, eksport do JSON nie wymaga konwersji, a jedyna zamiana na Date
 * dzieje sie na granicy z ts-fsrs (scheduler.ts). Patrz docs/adr/0006.
 */

import type { ItemKind, NoteType, Rating } from "@/lib/types";

export interface DeckRecord {
  id: string;
  name: string;
  description: string;
  newPerDay: number;
  maxReviewsPerDay: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteRecord {
  id: string;
  deckId: string;
  noteType: NoteType;
  /**
   * Pola wg KNOWN_FIELDS: Front, Back, Example oraz adnotacje - Pronunciation,
   * Synonyms, Formal. Do odcisku tresci wchodza tylko Front i Back.
   */
  fields: Record<string, string>;
  tags: string[];
  itemKind: ItemKind;
  /** Identyfikator w zrodle importu - do rozpoznania pozycji przy ponownym imporcie. */
  sourceRef: string | null;
  /** sha256 znormalizowanego przodu i tylu - deduplikacja miedzy importami. */
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Kiedy uzytkownik ostatnio poprawil fiszke recznie ("Edytuj").
   * Slownik wbudowany nie nadpisuje tresci ani kategorii takiej fiszki -
   * tylko dopisuje to, czego brakuje. Brak pola = nigdy nie poprawiana.
   */
  editedAt?: string;
}

/**
 * Zserializowana karta ts-fsrs (daty jako ISO). Traktowana jako calosc
 * nieprzezroczysta - pola naleza do biblioteki, my tylko je przechowujemy.
 * state: 0=New 1=Learning 2=Review 3=Relearning (inaczej niz py-fsrs,
 * ktore nie mialo stanu New).
 */
export interface FsrsSnapshot {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
}

export interface CardRecord {
  id: string;
  noteId: string;
  deckId: string;
  /** 0 = Front->Back, 1 = Back->Front, 2 = opis (synonimy) -> Front */
  templateOrd: 0 | 1 | 2;
  fsrs: FsrsSnapshot;
  /** Kopia fsrs.due - IndexedDB nie indeksuje pol zagniezdzonych. */
  due: string;
  /**
   * Karta odlozona na bok: nie wchodzi do kolejki, ale zachowuje caly stan
   * nauki. Sluzy do wyciszenia materialu, ktorego teraz nie chcemy widziec,
   * bez kasowania go razem z historia. Brak pola = karta czynna.
   */
  suspended?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Log powtorek - append-only zrodlo prawdy o nauce.
 *
 * deckId i itemKind sa zdenormalizowane celowo: skasowanie notatki nie moze
 * dziurawic statystyk, a rozbicie na kategorie materialu ma dzialac takze
 * dla materialu, ktorego juz nie ma.
 */
export interface ReviewLogRecord {
  id: string;
  cardId: string;
  deckId: string;
  itemKind: ItemKind;
  /**
   * Ktory kierunek karty (0/1/2). Zdenormalizowane jak deckId i itemKind:
   * bez tego nie da sie pozniej sprawdzic, czy karty opisowe sa trudniejsze
   * od zwyklych. Opcjonalne - wpisy sprzed tej zmiany go nie maja.
   */
  templateOrd?: number;
  rating: Rating;
  reviewDatetime: string;
  /** Wymagane (ADR 0005) - bez tego optymalizacja parametrow bylaby zamknieta. */
  durationMs: number;
  stateBefore: FsrsSnapshot;
  stateAfter: FsrsSnapshot;
  scheduler: string;
}

export interface SettingsRecord {
  id: "app";
  desiredRetention: number;
  /**
   * Data egzaminu (YYYY-MM-DD). Pozwala policzyc, ile nowych fiszek
   * dziennie trzeba wziac, zeby zdazyc przerobic material z zapasem na
   * utrwalenie. null = brak terminu, tempo nie jest liczone.
   */
  examDate?: string | null;
  /** null = wagi domyslne; wlasne pojawia sie po optymalizacji na historii. */
  fsrsParameters: number[] | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stan Slownika wbudowanego - pakietu dostarczanego razem z aplikacja
 * (ADR 0007). Rekord w sklepie `settings` pod id "slownik-wbudowany".
 */
export interface BundledStateRecord {
  id: "slownik-wbudowany";
  /** Sciezka pliku w pakiecie -> odcisk wersji, ktora juz weszla. */
  files: Record<string, string>;
  appliedAt: string | null;
  /**
   * Ktora wersja kodu wprowadzila pakiet. Gdy nie zgadza sie z DANE_WERSJA,
   * pliki wchodza ponownie - nowy kod potrafi wyciagnac z nich wiecej niz
   * stary, mimo ze same pliki sie nie zmienily. Brak = baza sprzed tego pola.
   */
  dataVersion?: number;
  /**
   * Odciski tresci i sourceRef fiszek skasowanych recznie. Pakiet ich nie
   * przywraca - skasowanie pojedynczej fiszki ma byc decyzja ostateczna.
   */
  removed: string[];
}
