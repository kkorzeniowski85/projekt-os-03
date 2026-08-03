/** Tresc notatki: odcisk do deduplikacji i zgadywanie kategorii materialu. */

import type { ItemKind } from "@/lib/types";

/** Nazwy pol notatki - te same co w formacie fiszki/v1 po normalizacji. */
export const FIELD_FRONT = "Front";
export const FIELD_BACK = "Back";
export const FIELD_EXAMPLE = "Example";
export const KNOWN_FIELDS = [FIELD_FRONT, FIELD_BACK, FIELD_EXAMPLE] as const;

/**
 * Odcisk tresci odporny na roznice formatowania - port z backendu.
 *
 * Przyklad nie wchodzi do odcisku: dopisanie zdania przykladowego nie czyni
 * fiszki nowa. (JS toLowerCase() zamiast pythonowego casefold() - roznica
 * dotyczy egzotycznych liter i nie ma znaczenia, bo wszystkie odciski liczy
 * ta sama implementacja.)
 */
export async function contentHash(fields: Record<string, string>): Promise<string> {
  const normalize = (value: string | undefined) =>
    (value ?? "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();
  const payload = [normalize(fields[FIELD_FRONT]), normalize(fields[FIELD_BACK])].join("\x1f");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const SENTENCE_END = /[.!?…]\s*$/;

/**
 * Zgaduje: slowo, fraza czy zdanie. EXPRESSION (idiom) celowo nie jest
 * zgadywane - heurystyka nie odrozni go od zwyklej frazy, a bledna etykieta
 * zafalszowalaby statystyki bardziej niz jej brak.
 */
export function guessItemKind(text: string): ItemKind {
  const stripped = (text ?? "").trim();
  if (!stripped) return "other";
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (SENTENCE_END.test(stripped) || tokens.length >= 5) return "sentence";
  if (tokens.length === 1) return "word";
  return "phrase";
}
