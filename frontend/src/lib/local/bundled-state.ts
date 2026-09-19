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

export function emptyBundledState(): BundledStateRecord {
  return { id: BUNDLED_STATE_ID, files: {}, appliedAt: null, removed: [] };
}

/** Rekord ze sklepu `settings` albo pusty stan, gdy pakiet jeszcze nie wszedl. */
export function asBundledState(
  record: SettingsRecord | BundledStateRecord | undefined,
): BundledStateRecord {
  return record && record.id === BUNDLED_STATE_ID ? record : emptyBundledState();
}
