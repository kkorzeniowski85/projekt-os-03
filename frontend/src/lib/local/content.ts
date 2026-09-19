/** Tresc notatki: odcisk do deduplikacji i zgadywanie kategorii materialu. */

import type { ItemKind } from "@/lib/types";

/** Nazwy pol notatki - te same co w formacie fiszki/v1 po normalizacji. */
export const FIELD_FRONT = "Front";
export const FIELD_BACK = "Back";
export const FIELD_EXAMPLE = "Example";
export const FIELD_PRONUNCIATION = "Pronunciation";
export const FIELD_SYNONYMS = "Synonyms";
export const FIELD_FORMAL = "Formal";

/**
 * NOWE POLA DOPISUJEMY ZAWSZE NA KONCU.
 *
 * Ta tablica ustala kolejnosc kluczy w zapisanym rekordzie (uporzadkujPola),
 * a ta kolejnosc wchodzi do JSON.stringify w differs() przy imporcie i w
 * porownaniu tresci w updateNote. Wstawienie pola w srodku przetasowaloby
 * klucze we wszystkich istniejacych notatkach: import zglosilby "zaktualizowano
 * 229 fiszek", ktore niczego nie zmienily, a edycja postawilaby editedAt.
 * editedAt jest furtka jednokierunkowa - taka fiszka przestaje dostawac
 * poprawki z pakietu wbudowanego.
 */
export const KNOWN_FIELDS = [
  FIELD_FRONT,
  FIELD_BACK,
  FIELD_EXAMPLE,
  FIELD_PRONUNCIATION,
  FIELD_SYNONYMS,
  FIELD_FORMAL,
] as const;

/** Jedyne miejsce ustalajace kolejnosc i czystosc kluczy w rekordzie. */
export function uporzadkujPola(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KNOWN_FIELDS) {
    const value = (raw[name] ?? "").trim();
    if (value) out[name] = value;
  }
  return out;
}

/**
 * Rozbija liste na czlony. Ukosnik MUSI miec spacje wokol.
 *
 * W pakiecie sa czlony z ukosnikiem w srodku ("temporary/covering doctor",
 * "to explain in simple/plain language") - naiwne split("/") rozbiloby je
 * na polowy i zrobilo z jednego pojecia dwa bezsensowne.
 */
export function splitCzlony(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(/\s+\/\s+/)
    .map((czlon) => czlon.trim())
    .filter(Boolean);
}

/**
 * Odcisk tresci odporny na roznice formatowania - port z backendu.
 *
 * Do odcisku wchodzi WYLACZNIE para znaczeniowa przod-tyl. Zasada: pole,
 * ktorego zmiana nie moze utworzyc nowej fiszki, nie wchodzi do odcisku.
 * Dopisanie przykladu, wymowy, synonimow czy odpowiednika formalnego nie
 * czyni fiszki nowa - te same slowo opisane pelniej to nadal to samo slowo.
 * Gdyby weszly, jedno uzupelnienie pakietu zamienilo by sie z 229 aktualizacji
 * w 229 duplikatow. (JS toLowerCase() zamiast pythonowego casefold() - roznica
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
