"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell, ErrorBanner } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  ITEM_KIND_LABELS,
  MAPPING_TARGET_LABELS,
  type AnalyzeResult,
  type CommitResult,
  type Deck,
  type ImportFormat,
  type ItemKind,
  type NoteDraft,
  type NoteType,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-white/20";

type HeaderChoice = "auto" | "yes" | "no";

export default function ImportPage() {
  return (
    <AppShell>
      <Importer />
    </AppShell>
  );
}

function Importer() {
  const { user } = useAuth();

  const [formats, setFormats] = useState<ImportFormat[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [headerChoice, setHeaderChoice] = useState<HeaderChoice>("auto");

  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<NoteDraft[]>([]);

  const [deckId, setDeckId] = useState("");
  const [noteType, setNoteType] = useState<NoteType>("basic");
  const [defaultKind, setDefaultKind] = useState<ItemKind | "">("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const [formatData, deckData] = await Promise.all([
          api<ImportFormat[]>("/import/formats"),
          api<Deck[]>("/decks"),
        ]);
        setFormats(formatData);
        setDecks(deckData);
        if (deckData.length > 0) setDeckId(deckData[0].id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Nie udalo sie wczytac danych");
      }
    })();
  }, [user]);

  async function analyze() {
    if (!file && !pasted.trim()) {
      setError("Wybierz plik albo wklej treść");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      if (file) {
        form.append("file", file);
      } else {
        form.append("content", pasted);
        form.append("filename", "wklejone.txt");
      }
      if (headerChoice !== "auto") {
        form.append("has_header", headerChoice === "yes" ? "true" : "false");
      }

      const data = await api<AnalyzeResult>("/import/analyze", { method: "POST", body: form });
      setAnalysis(data);
      setMapping(data.suggested_mapping);
      setPreview(data.preview);
      setNoteType(data.suggested_note_type);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie przeanalizować źródła");
    } finally {
      setBusy(false);
    }
  }

  const refreshPreview = useCallback(
    async (next: Record<string, string>) => {
      if (!analysis) return;
      try {
        setPreview(
          await api<NoteDraft[]>(`/import/${analysis.job_id}/preview`, {
            method: "POST",
            body: next,
          }),
        );
      } catch {
        // Podglad jest pomocniczy - jego blad nie ma blokowac importu.
      }
    },
    [analysis],
  );

  function changeMapping(column: string, target: string) {
    const next = { ...mapping, [column]: target };
    setMapping(next);
    void refreshPreview(next);
  }

  async function commit() {
    if (!analysis || !deckId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<CommitResult>(`/import/${analysis.job_id}/commit`, {
        method: "POST",
        body: {
          deck_id: deckId,
          mapping,
          note_type: noteType,
          default_item_kind: defaultKind || null,
          skip_duplicates: skipDuplicates,
        },
      });
      setResult(data);
      setAnalysis(null);
      setPreview([]);
      setFile(null);
      setPasted("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie zaimportować");
    } finally {
      setBusy(false);
    }
  }

  const targets = analysis?.mapping_targets ?? [];
  const mapped = new Set(Object.values(mapping));
  const canCommit = mapped.has("Front") && mapped.has("Back") && Boolean(deckId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import fiszek</h1>
        <p className="mt-1 text-sm opacity-70">
          Dowolny format wchodzi, wychodzi jeden — nasz. Najpierw podgląd i mapowanie kolumn,
          dopiero potem zapis.
        </p>
      </div>

      {result && (
        <div className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium">
            Zaimportowano {result.imported} z {result.total_items} pozycji.
          </p>
          {result.skipped_duplicates > 0 && (
            <p className="opacity-80">Pominięto duplikatów: {result.skipped_duplicates}.</p>
          )}
          {result.skipped_invalid > 0 && (
            <p className="opacity-80">Pominięto niekompletnych: {result.skipped_invalid}.</p>
          )}
          <Link href={`/decks/${result.deck_id}/notes`} className="inline-block underline">
            Zobacz talię
          </Link>
        </div>
      )}

      {!analysis && (
        <section className="space-y-4 rounded-lg border border-black/10 p-4 dark:border-white/15">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Plik</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.md,.json,.apkg,.colpkg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
            />
          </label>

          <div className="text-sm opacity-70">albo wklej treść:</div>

          <textarea
            rows={5}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"kot - cat\npies - dog"}
            className={`${inputClass} font-mono`}
          />

          <label className="block space-y-1">
            <span className="text-sm">Pierwszy wiersz (CSV/TSV)</span>
            <select
              value={headerChoice}
              onChange={(e) => setHeaderChoice(e.target.value as HeaderChoice)}
              className={inputClass}
            >
              <option value="auto">Rozpoznaj automatycznie</option>
              <option value="yes">To nagłówek z nazwami kolumn</option>
              <option value="no">To już pierwsza fiszka</option>
            </select>
          </label>

          <ErrorBanner message={error} />

          <button
            type="button"
            onClick={() => void analyze()}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Analizuję…" : "Analizuj"}
          </button>

          {formats.length > 0 && (
            <details className="text-sm opacity-70">
              <summary className="cursor-pointer">Obsługiwane formaty</summary>
              <ul className="mt-2 space-y-1">
                {formats.map((format) => (
                  <li key={format.key}>
                    <span className="font-medium">{format.label}</span>{" "}
                    <span className="opacity-70">
                      ({format.extensions.join(", ")}) — {format.description}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {analysis && (
        <>
          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">{analysis.filename}</h2>
              <span className="text-sm opacity-70">
                format: {analysis.source_format} · pozycji: {analysis.total_items}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="W pliku" value={analysis.duplicates.total} />
              <Stat label="Unikalnych" value={analysis.duplicates.unique} />
              <Stat label="Powtórzeń w pliku" value={analysis.duplicates.duplicates_in_file} />
              <Stat label="Już w kolekcji" value={analysis.duplicates.already_in_collection} />
            </dl>

            {analysis.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                {analysis.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}

            {analysis.source_decks.length > 0 && (
              <p className="text-sm opacity-70">
                Talie w źródle: {analysis.source_decks.join(", ")}. Wszystko trafi do jednej
                wybranej niżej talii — podział na talie dojdzie później.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 className="font-medium">Mapowanie kolumn</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {analysis.columns.map((column) => (
                <label key={column} className="flex items-center gap-2 text-sm">
                  <span className="w-1/2 truncate font-mono text-xs opacity-80" title={column}>
                    {column}
                  </span>
                  <select
                    value={mapping[column] ?? "ignore"}
                    onChange={(e) => changeMapping(column, e.target.value)}
                    className="flex-1 rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
                  >
                    {targets.map((target) => (
                      <option key={target} value={target}>
                        {MAPPING_TARGET_LABELS[target] ?? target}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!canCommit && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Wskaż kolumny dla przodu i tyłu fiszki.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 className="font-medium">Podgląd</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="opacity-60">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Przód</th>
                    <th className="py-1 pr-3 font-normal">Tył</th>
                    <th className="py-1 pr-3 font-normal">Kategoria</th>
                    <th className="py-1 font-normal">Tagi</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((draft, index) => (
                    <tr key={index} className="border-t border-black/5 dark:border-white/10">
                      <td className="py-1 pr-3">{draft.fields.Front}</td>
                      <td className="py-1 pr-3">{draft.fields.Back}</td>
                      <td className="py-1 pr-3 opacity-70">
                        {ITEM_KIND_LABELS[draft.item_kind]}
                      </td>
                      <td className="py-1 opacity-70">{draft.tags.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.length === 0 && (
              <p className="text-sm opacity-70">Przy tym mapowaniu nie powstaje żadna fiszka.</p>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 className="font-medium">Zapis</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm">Talia docelowa</span>
                <select
                  value={deckId}
                  onChange={(e) => setDeckId(e.target.value)}
                  className={inputClass}
                >
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-sm">Typ notatki</span>
                <select
                  value={noteType}
                  onChange={(e) => setNoteType(e.target.value as NoteType)}
                  className={inputClass}
                >
                  <option value="basic">Jednostronna</option>
                  <option value="basic_reversed">Dwustronna (2 karty na fiszkę)</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-sm">Kategoria materiału</span>
                <select
                  value={defaultKind}
                  onChange={(e) => setDefaultKind(e.target.value as ItemKind | "")}
                  className={inputClass}
                >
                  <option value="">Rozpoznaj z treści</option>
                  {(Object.keys(ITEM_KIND_LABELS) as ItemKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      wszystko jako: {ITEM_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
                <span className="block text-xs opacity-60">
                  Wyrażeń (idiomów) heurystyka nie rozpozna — ustaw ręcznie albo zmapuj kolumnę.
                </span>
              </label>

              <label className="flex items-center gap-2 self-end text-sm">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                />
                Pomiń fiszki, które już mam
              </label>
            </div>

            <ErrorBanner message={error} />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void commit()}
                disabled={busy || !canCommit}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {busy ? "Importuję…" : `Importuj ${analysis.total_items} pozycji`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAnalysis(null);
                  setPreview([]);
                  setError(null);
                }}
                className="rounded-md border border-black/15 px-3 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Anuluj
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-black/5 px-3 py-2 dark:bg-white/10">
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}
