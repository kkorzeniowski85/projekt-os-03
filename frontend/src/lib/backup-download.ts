import {
  backupCounts,
  backupFilename,
  exportBackup,
  type BackupCounts,
} from "@/lib/local/backup";
import { updateSettings } from "@/lib/local/repo";
import { odmien } from "@/lib/types";

/** Zawartosc kopii jednym zdaniem - do komunikatu po pobraniu i przy wczytaniu. */
export function opiszKopie(counts: BackupCounts): string {
  return (
    `${counts.decks} ${odmien(counts.decks, "talia", "talie", "talii")} · ` +
    `${counts.notes} ${odmien(counts.notes, "fiszka", "fiszki", "fiszek")} · ` +
    `${counts.cards} ${odmien(counts.cards, "karta", "karty", "kart")} · ` +
    `${counts.reviews} ${odmien(counts.reviews, "powtórka", "powtórki", "powtórek")}`
  );
}

/**
 * Pobranie kopii jako pliku - jedno klikniecie, wspolne dla paska
 * przypomnienia na ekranie glownym i dla Ustawien.
 *
 * Pasek prowadzil wczesniej do Ustawien, gdzie kopia byla szosta sekcja
 * od gory, i trzeba bylo jej szukac miedzy innymi przyciskami.
 */
export async function pobierzKopie(
  now = new Date(),
): Promise<{ counts: BackupCounts; filename: string }> {
  const payload = await exportBackup(now);
  const filename = backupFilename(now);
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // Link w dokumencie i adres zwalniany z opoznieniem: czesc przegladarek
  // rozwiazuje blob: asynchronicznie i natychmiastowe zwolnienie urywa
  // pobieranie, mimo ze komunikat mowilby o zapisanej kopii.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  await updateSettings({ lastBackupAt: now.toISOString() });
  return { counts: backupCounts(payload), filename };
}
