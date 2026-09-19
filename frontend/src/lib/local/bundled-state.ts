/**
 * Stan Slownika wbudowanego: co juz weszlo i czego nie przywracac.
 *
 * Osobny, maly modul bez zaleznosci od repo.ts, bo korzysta z niego zarowno
 * kasowanie notatki (repo.ts), jak i sama dostawa pakietu (bundled.ts).
 * Rekord zyje w sklepie `settings` obok ustawien aplikacji - osobny sklep
 * wymagalby migracji schematu, a to jest jeden rekord wielkosci kilku linii.
 */

import type { BundledStateRecord, SettingsRecord } from "./types";

export const BUNDLED_STATE_ID = "slownik-wbudowany";

/**
 * Wersja KSZTALTU danych, ktory aplikacja potrafi wyciagnac z pakietu.
 * Podbijamy ja, gdy nowy kod czyta z plikow cos, czego stary nie czytal -
 * wtedy pakiet trzeba wprowadzic ponownie, choc pliki sie nie zmienily.
 * 2 = aplikacja rozpoznaje wymowe, synonimy i odpowiednik formalny.
 */
export const DANE_WERSJA = 2;

export function emptyBundledState(): BundledStateRecord {
  return { id: BUNDLED_STATE_ID, files: {}, appliedAt: null, removed: [], dataVersion: DANE_WERSJA };
}

/** Rekord ze sklepu `settings` albo pusty stan, gdy pakiet jeszcze nie wszedl. */
export function asBundledState(
  record: SettingsRecord | BundledStateRecord | undefined,
): BundledStateRecord {
  return record && record.id === BUNDLED_STATE_ID ? record : emptyBundledState();
}
