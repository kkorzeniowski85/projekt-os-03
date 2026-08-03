/**
 * Typy odpowiadajace schematom Pydantica z backendu.
 *
 * Docelowo generowane z OpenAPI, zeby nie utrzymywac ich recznie w dwoch
 * miejscach. Gdy backend chodzi:
 *
 *   npm run gen:api
 *
 * i podmien import na wygenerowany plik. Na razie recznie - jest ich malo.
 */

export type NoteType = "basic" | "basic_reversed";

/** Kategoria materialu - os, wzdluz ktorej liczone sa statystyki. */
export type ItemKind = "word" | "phrase" | "expression" | "sentence" | "other";

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  word: "słowo",
  phrase: "fraza",
  expression: "wyrażenie",
  sentence: "zdanie",
  other: "inne",
};

/** 1 = Again, 2 = Hard, 3 = Good, 4 = Easy (zgodnie z fsrs.Rating). */
export type Rating = 1 | 2 | 3 | 4;

/** 1 = Learning, 2 = Review, 3 = Relearning (fsrs.State - nie ma stanu "New"). */
export type CardState = 1 | 2 | 3;

export interface User {
  id: string;
  email: string;
  display_name: string;
  desired_retention: number;
  created_at: string;
}

export interface DeckCounts {
  new: number;
  due: number;
  total: number;
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  new_per_day: number;
  max_reviews_per_day: number;
  created_at: string;
  updated_at: string;
  counts: DeckCounts | null;
}

export interface Card {
  id: string;
  template_ord: number;
  template_label: string;
  state: CardState;
  due: string;
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  is_new: boolean;
}

export interface Note {
  id: string;
  deck_id: string;
  note_type: NoteType;
  fields: Record<string, string>;
  tags: string[];
  created_at: string;
  updated_at: string;
  cards: Card[];
}

export interface NoteList {
  items: Note[];
  total: number;
}

export interface StudyCard {
  card_id: string;
  note_id: string;
  deck_id: string;
  question: string;
  answer: string;
  example: string;
  template_label: string;
  tags: string[];
  state: CardState;
  is_new: boolean;
  due: string;
  interval_preview: Record<string, string>;
}

export interface StudyQueue {
  deck_id: string;
  cards: StudyCard[];
  new_remaining: number;
  due_remaining: number;
}

export interface ReviewResult {
  card_id: string;
  state: CardState;
  due: string;
  scheduled_label: string;
  reps: number;
  lapses: number;
  duplicate: boolean;
}

export const RATING_LABELS: Record<Rating, string> = {
  1: "Znowu",
  2: "Trudne",
  3: "Dobre",
  4: "Latwe",
};

// --- import ---------------------------------------------------------------

export interface ImportFormat {
  key: string;
  label: string;
  extensions: string[];
  description: string;
}

export interface NoteDraft {
  fields: Record<string, string>;
  tags: string[];
  item_kind: ItemKind;
  source_deck: string | null;
  /** Typ narzucony przez zrodlo dla tej pozycji. null = typ wybrany przy imporcie. */
  note_type: NoteType | null;
}

export interface DuplicateSummary {
  total: number;
  unique: number;
  duplicates_in_file: number;
  already_in_collection: number;
}

export interface AnalyzeResult {
  job_id: string;
  filename: string;
  source_format: string;
  columns: string[];
  suggested_mapping: Record<string, string>;
  mapping_targets: string[];
  suggested_note_type: NoteType;
  source_decks: string[];
  warnings: string[];
  total_items: number;
  preview: NoteDraft[];
  duplicates: DuplicateSummary;
}

export interface CommitResult {
  job_id: string;
  deck_id: string;
  imported: number;
  skipped_duplicates: number;
  skipped_invalid: number;
  total_items: number;
}

/** Etykiety celow mapowania kolumn. */
export const MAPPING_TARGET_LABELS: Record<string, string> = {
  Front: "Przód",
  Back: "Tył",
  Example: "Przykład",
  tags: "Tagi",
  kind: "Kategoria",
  ignore: "— pomiń —",
};

// --- statystyki -----------------------------------------------------------

export interface DailyPoint {
  day: string;
  reviews: number;
  seconds: number;
  retention: number | null;
}

export interface Overview {
  days: number;
  reviews: number;
  reviews_all_time: number;
  cards_touched: number;
  total_seconds: number;
  seconds_per_review: number | null;
  retention: number | null;
  retention_young: number | null;
  retention_mature: number | null;
  retention_sample: number;
  streak_days: number;
  daily: DailyPoint[];
  ratings: Record<string, number>;
}

export interface ItemKindStats {
  item_kind: ItemKind;
  cards: number;
  notes: number;
  new_cards: number;
  reviews: number;
  retention: number | null;
  retention_sample: number;
  avg_stability_days: number | null;
  avg_difficulty: number | null;
  lapses: number;
  seconds_per_review: number | null;
}

export interface LeechCard {
  card_id: string;
  note_id: string;
  front: string;
  back: string;
  item_kind: ItemKind;
  deck_name: string;
  lapses: number;
  reps: number;
  stability_days: number | null;
  difficulty: number | null;
  is_leech: boolean;
}

export interface ForecastPoint {
  day: string;
  count: number;
}
