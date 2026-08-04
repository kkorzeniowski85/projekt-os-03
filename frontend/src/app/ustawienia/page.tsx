"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell, ErrorBanner } from "@/components/AppShell";
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
import { storageEstimate } from "@/lib/local/db";

function describe(counts: BackupCounts): string {
  return (
    `${counts.decks} ${counts.decks === 1 ? "talia" : "talii"} · ` +
    `${counts.notes} fiszek · ${counts.cards} kart · ${counts.reviews} powtórek`
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setCounts(await currentCounts());
    setStorage(await storageEstimate());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      link.click();
      URL.revokeObjectURL(url);
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
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Ustawienia</h1>

      <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 className="font-medium">Twoje dane</h2>
        <p className="text-sm opacity-70">{counts ? describe(counts) : "Liczenie…"}</p>
        {storage && (
          <p className="text-xs opacity-60">
            Pamięć trwała:{" "}
            {storage.persisted ? (
              <strong className="text-emerald-700 dark:text-emerald-300">włączona</strong>
            ) : (
              <strong className="text-amber-700 dark:text-amber-300">niepotwierdzona</strong>
            )}
            {storage.usageMb !== null && ` · zajęte: ${storage.usageMb} MB`}
          </p>
        )}
        <p className="rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm">
          Wszystko, czego się nauczysz, jest zapisane <strong>wyłącznie w tej
          przeglądarce</strong>. Wyczyszczenie danych aplikacji albo utrata urządzenia
          bez świeżej kopii oznacza utratę całej historii nauki. Rób kopię regularnie
          i trzymaj ją poza telefonem — na przykład na Dysku Google.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 className="font-medium">Kopia zapasowa</h2>
        <p className="text-sm opacity-70">
          Zapisuje wszystko do jednego pliku: talie, fiszki, stan powtórek i całą
          historię nauki. Ten sam plik przenosi dane na inne urządzenie.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void download()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Pobierz kopię
        </button>
      </section>

      <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 className="font-medium">Przywracanie</h2>
        <p className="text-sm opacity-70">
          Wczytanie kopii <strong>zastąpi</strong> wszystkie obecne dane. Nie scala
          kolekcji — jeśli masz tu coś, czego nie ma w kopii, najpierw pobierz kopię
          bieżącego stanu.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-black/5 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-black/10 dark:file:bg-white/10 dark:hover:file:bg-white/20"
        />

        {pending && (
          <div className="space-y-2 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2">
            <p className="text-sm">
              <strong>{pending.name}</strong> — kopia z{" "}
              {new Date(pending.file.exportedAt).toLocaleString("pl-PL")}
              <br />
              Zawiera: {describe(backupCounts(pending.file))}
            </p>
            {counts && (
              <p className="text-sm">
                Zostanie zastąpione: {describe(counts)}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmRestore()}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
              >
                Zastąp moje dane
              </button>
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
                className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Anuluj
              </button>
            </div>
          </div>
        )}
      </section>

      <ErrorBanner message={error} />
      {message && (
        <p className="rounded-md border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
