/**
 * Zamiana notatki na tresc karty - port backend/app/core/rendering.py.
 *
 * templateOrd 0 pyta o przod, 1 o tyl, 2 o termin na podstawie opisu.
 *
 * Kluczowa zasada tego modulu: ADNOTACJE CZYTAMY Z ROZBIOREM W LOCIE.
 * Wymowa, synonimy i odpowiednik formalny maja wlasne pola, ale w bazach
 * sprzed tej zmiany - i w kazdej przywroconej starszej kopii - siedza sklejone
 * w polu Example. Dzieki rozbiorowi przy odczycie ekran nauki jest poprawny
 * NIEZALEZNIE od tego, czy naprawa danych zdazyla sie wykonac. Naprawa jest
 * porzadkiem, nie warunkiem poprawnosci.
 */

import {
  FIELD_BACK,
  FIELD_EXAMPLE,
  FIELD_FORMAL,
  FIELD_FRONT,
  FIELD_PRONUNCIATION,
  FIELD_SYNONYMS,
} from "./content";
import { splitLegacyExample } from "./legacy-example";
import type { NoteRecord } from "./types";

/**
 * Wskazowka karty opisowej: WYLACZNIE synonimy.
 *
 * Odpowiednik formalny celowo NIE jest wskazowka. Pytanie "to follow up on"
 * z odpowiedzia "to chase up" cwiczyloby produkcje kolokwializmu - dokladnie
 * tego, za co OET Writing obniza ocene. Rejestr formalny zasluguje na wlasny
 * tryb (potocznie -> formalnie), nie na odwrocenie tego istniejacego.
 */
export function cueOf(note: NoteRecord): string {
  const wprost = note.fields[FIELD_SYNONYMS];
  if (wprost) return wprost;
  return splitLegacyExample(note.fields[FIELD_EXAMPLE]).synonyms;
}

export function pronunciationOf(note: NoteRecord): string {
  return (
    note.fields[FIELD_PRONUNCIATION] ||
    splitLegacyExample(note.fields[FIELD_EXAMPLE]).pronunciation
  );
}

export function formalOf(note: NoteRecord): string {
  return note.fields[FIELD_FORMAL] || splitLegacyExample(note.fields[FIELD_EXAMPLE]).formal;
}

export function renderCard(
  note: NoteRecord,
  templateOrd: number,
): { question: string; answer: string } {
  const front = note.fields[FIELD_FRONT] ?? "";
  const back = note.fields[FIELD_BACK] ?? "";

  if (templateOrd === 2) {
    const cue = cueOf(note);
    // Pusta wskazowka (uzytkownik wyczyscil synonimy) - karta zachowuje sie
    // jak przod->tyl zamiast pokazac pusty ekran z przyciskiem "Pokaz
    // odpowiedz", co wyglada jak awaria aplikacji.
    return cue ? { question: cue, answer: front } : { question: front, answer: back };
  }

  return templateOrd === 0 ? { question: front, answer: back } : { question: back, answer: front };
}

/** Zdanie przykladowe - pokazywane z odpowiedzia, puste gdy brak. */
export function exampleOf(note: NoteRecord): string {
  const raw = note.fields[FIELD_EXAMPLE] ?? "";
  // Pusty wynik rozbioru przy niepustym zrodle oznacza, ze cale pole bylo
  // naglowkiem - wtedy lepiej pokazac oryginal niz nic.
  return splitLegacyExample(raw).example || raw;
}

export function templateLabel(templateOrd: number): string {
  if (templateOrd === 2) return "opis → termin";
  return templateOrd === 0 ? "przód → tył" : "tył → przód";
}
