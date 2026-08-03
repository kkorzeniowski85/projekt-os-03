/**
 * Zamiana notatki na tresc karty - port backend/app/core/rendering.py.
 * templateOrd 0 pyta o przod, 1 (tylko notatka dwustronna) o tyl.
 */

import { FIELD_BACK, FIELD_EXAMPLE, FIELD_FRONT } from "./content";
import type { NoteRecord } from "./types";

export function renderCard(
  note: NoteRecord,
  templateOrd: number,
): { question: string; answer: string } {
  const front = note.fields[FIELD_FRONT] ?? "";
  const back = note.fields[FIELD_BACK] ?? "";
  return templateOrd === 0
    ? { question: front, answer: back }
    : { question: back, answer: front };
}

/** Zdanie przykladowe - pokazywane z odpowiedzia, puste gdy brak. */
export function exampleOf(note: NoteRecord): string {
  return note.fields[FIELD_EXAMPLE] ?? "";
}

export function templateLabel(templateOrd: number): string {
  return templateOrd === 0 ? "Przod → Tyl" : "Tyl → Przod";
}
