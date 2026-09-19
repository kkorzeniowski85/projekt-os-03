"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell, ErrorBanner, buttonClass, secondaryButtonClass } from "@/components/AppShell";
import {
  backupCounts,
  backupFilename,
  currentCounts,
  exportBackup,
  parseBackup,
  restoreBackup,
  type BackupCounts,
  type BackupFile,
} from "@/lib/local/backup";
import { BUNDLED_EVENT, applyBundled, bundledState } from "@/lib/local/bundled";
import { storageEstimate } from "@/lib/local/db";
import type { BundledStateRecord } from "@/lib/local/types";
import { odmien } from "@/lib/types";

function describe(counts: BackupCounts): string {
  return (
    `${counts.decks} ${odmien(counts.decks, "talia", "talie", "talii")} · ` +
    `${counts.notes} ${odmien(counts.notes, "fiszka", "fiszki", "fiszek")} · ` +
    `${counts.cards} ${odmien(counts.cards, "karta", "karty", "kart")} · ` +
    `${counts.reviews} ${odmien(counts.reviews, "powtórka", "powtórki", "powtórek")}`
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <Settings />
    </AppShell>
  );
}

function Settings() {
  const [counts, setCounts] = useState<BackupCounts | null>(null);
  const [storage, setStorage] = useState<{ persisted: boolean; usageMb: number | null } | null>(
    null,
  );
  const [pending, setPending] = useState<{ file: BackupFile; name: string } | null>(null);
  const [bundled, setBundled] = useState<BundledStateRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setCounts(await currentCounts());
      setStorage(await storageEstimate());
      setBundled(await bundledState());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się odczytać danych");
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Cicha aktualizacja Slownika konczy sie zwykle juz po wczytaniu tego
    // ekranu - liczniki i data maja to pokazac bez przeladowania.
    const onBundled = () => void refresh();
    window.addEventListener(BUNDLED_EVENT, onBundled);
    return () => window.removeEventListener(BUNDLED_EVENT, onBundled);
  }, [refresh]);

  async function updateDictionary() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await applyBundled();
      if (result.status === "applied") {
        const fiszek = (n: number) => `${n} ${odmien(n, "fiszkę", "fiszki", "fiszek")}`;
        const pominieto = result.failed.length ? ` Pominięto: ${result.failed.join("; ")}.` : "";
        setMessage(
          `Słownik zaktualizowany: dodano ${fiszek(result.imported)}, ` +
            `uzupełniono ${fiszek(result.updated)}.${pominieto}`,
        );
      } else if (result.status === "up-to-date") {
        setMessage("Słownik jest aktualny.");
      } else {
        setError(result.message ?? "Nie udało się sprawdzić pakietu.");
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się zaktualizować słownika");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const payload = await exportBackup(now);
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = backupFilename(now);
      // Link w dokumencie i adres zwalniany z opoznieniem: czesc przegladarek
      // rozwiazuje blob: asynchronicznie i natychmiastowe zwolnienie urywa
      // pobieranie, mimo ze komunikat mowilby o zapisanej kopii.
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(`Zapisano kopię: ${describe(backupCounts(payload))}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się zapisać kopii");
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(file: File | null) {
    if (!file) return;
    setError(null);
    setMessage(null);
    try {
      setPending({ file: parseBackup(await file.text()), name: file.name });
    } catch (caught) {
      setPending(null);
      setError(caught instanceof Error ? caught.message : "Nie udało się odczytać pliku");
    }
  }

  async function confirmRestore() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await restoreBackup(pending.file);
      setPending(null);
      if (fileInput.current) fileInput.current.value = "";
      setMessage(`Przywrócono kopię: ${describe(restored)}.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się przywrócić kopii");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Ustawienia</h1>

      <section className="rounded-xl border border-line bg-surface p-4">
        <p className="text-xs tracking-[0.01em] text-ink-3">TWOJE DANE</p>
        <p className="mt-1.5 text-[15px] leading-relaxed">
          {counts ? describe(counts) : "Liczenie…"}
        </p>
        {storage && (
          <p className="mt-2.5 flex items-center gap-2 border-t border-line-soft pt-3 text-[13px] text-ink-2">
            {storage.persisted ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-good"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-hard"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            )}
            Pamięć trwała {storage.persisted ? "włączona" : "niepotwierdzona"}
            {storage.usageMb !== null && ` · ${String(storage.usageMb).replace(".", ",")} MB`}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <p className="text-xs tracking-[0.01em] text-ink-3">SŁOWNIK WBUDOWANY</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          Aplikacja niesie Słownik w sobie. Przy każdym otwarciu z dostępem do sieci
          sprawdza, czy pakiet się zmienił, i dopisuje różnicę. Stan powtórek zostaje
          nietknięty, fiszki poprawione ręcznie nie są nadpisywane, a skasowane nie
          wracają.
        </p>
        <p className="mt-2.5 border-t border-line-soft pt-3 text-[13px] text-ink-2">
          {bundled?.appliedAt
            ? `Ostatnia aktualizacja: ${new Date(bundled.appliedAt).toLocaleString("pl-PL")}`
            : "Pakiet nie został jeszcze wprowadzony."}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void updateDictionary()}
          className={`${secondaryButtonClass} mt-3 w-full py-3`}
        >
          Aktualizuj słownik
        </button>
      </section>

      {/* Jedyne miejsce, gdzie aplikacja podnosi glos. */}
      <section className="flex gap-3 rounded-xl border border-hard-line bg-hard-bg p-4">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 shrink-0 text-hard"
        >
          <path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        <p className="text-[13px] leading-relaxed text-ink-2">
          Wszystko, czego się uczysz, jest zapisane{" "}
          <strong className="font-medium text-ink">wyłącznie w tej przeglądarce</strong>.
          Wyczyszczenie danych albo utrata urządzenia bez świeżej kopii oznacza utratę całej
          historii nauki. Rób kopię regularnie i trzymaj ją poza telefonem.
        </p>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <p className="text-xs tracking-[0.01em] text-ink-3">KOPIA ZAPASOWA</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          Jeden plik z taliami, fiszkami, stanem powtórek i całą historią nauki. Ten sam plik
          przenosi dane na inne urządzenie.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void download()}
          className={`${buttonClass} mt-3 w-full py-3`}
        >
          Pobierz kopię
        </button>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium">Przywracanie</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Wczytanie kopii <strong className="font-medium text-ink">zastąpi</strong> wszystkie
          obecne dane. Nie scala kolekcji — jeśli masz tu coś, czego nie ma w kopii, najpierw
          pobierz kopię bieżącego stanu.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          className="mt-3 block w-full text-[13px] text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-canvas file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-ink hover:file:border-field"
        />

        {pending && (
          <div className="mt-3 space-y-2.5 rounded-lg border border-hard-line bg-hard-bg p-3">
            <p className="text-[13px] leading-relaxed">
              <strong className="font-medium">{pending.name}</strong>
              <br />
              <span className="text-ink-2">
                kopia z {new Date(pending.file.exportedAt).toLocaleString("pl-PL")}
              </span>
              <br />
              Zawiera: {describe(backupCounts(pending.file))}
            </p>
            {counts && (
              <p className="text-[13px] text-ink-2">Zostanie zastąpione: {describe(counts)}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmRestore()}
                className="rounded-lg bg-again px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
              >
                Zastąp moje dane
              </button>
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
                className={secondaryButtonClass}
              >
                Anuluj
              </button>
            </div>
          </div>
        )}
      </section>

      <ErrorBanner message={error} />
      {message && (
        <p className="rounded-lg border border-good-line bg-good-bg px-3 py-2.5 text-sm text-good">
          {message}
        </p>
      )}
    </div>
  );
}
