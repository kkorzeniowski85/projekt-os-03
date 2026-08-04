"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell, ErrorBanner } from "@/components/AppShell";
import {
  FORMATS,
  ImportParseError,
  MAPPING_TARGETS,
  type ParseResult,
  parseSource,
} from "@/lib/local/import";
import {
  type CommitStats,
  type DuplicateSummary,
  type NoteDraft,
  commitImport,
  duplicateSummary,
  normalize,
  preview,
} from "@/lib/local/import/service";
import { createDeck, listDecks } from "@/lib/local/repo";
import type { DeckRecord } from "@/lib/local/types";
import {
  ITEM_KIND_LABELS,
  MAPPING_TARGET_LABELS,
  type ItemKind,
  type NoteType,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-white/20";

const NEW_DECK = "__new__";

export default function ImportPage() {
  return (
    <AppShell>
      <Importer />
    </AppShell>
  );
}

function Importer() {
  // --- zrodlo ---
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [formatKey, setFormatKey] = useState("auto");
  const fileData = useRef<Uint8Array | null>(null);

  // --- analiza ---
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [hasHeader, setHasHeader] = useState<boolean | null>(null);
  const [drafts, setDrafts] = useState<NoteDraft[]>([]);
  const [summary, setSummary] = useState<DuplicateSummary | null>(null);

  // --- decyzje importu ---
  const [decks, setDecks] = useState<DeckRecord[]>([]);
  const [deckChoice, setDeckChoice] = useState("");
  const [newDeckName, setNewDeckName] = useState("");
  const [noteType, setNoteType] = useState<NoteType>("basic");
  const [defaultKind, setDefaultKind] = useState<ItemKind | "">("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const [done, setDone] = useState<(CommitStats & { deckId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listDecks().then((all) => setDecks(all));
  }, [done]);

  // Normalizacja przy kazdej zmianie mapowania - podglad na zywo, bez serwera.
  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    void (async () => {
      const next = await normalize(parsed, mapping, defaultKind || null);
      if (cancelled) return;
      setDrafts(next);
      setSummary(await duplicateSummary(next));
    })();
    return () => {
      cancelled = true;
    };
  }, [parsed, mapping, defaultKind]);

  const analyze = useCallback(
    (override?: boolean | null) => {
      setError(null);
      setDone(null);
      const data = fileData.current ?? new TextEncoder().encode(pasted);
      // Schowek celowo bez rozszerzenia: o formacie wklejonej tresci ma
      // decydowac zawartosc, nie zmyslona nazwa pliku. Z ".txt" wklejony
      // CSV szedlby sciezka zwyklego tekstu i rozpadal sie na pierwszym
      // sredniku.
      const name = fileName ?? "schowek";
      if (data.length === 0) {
        setError("Nie przeslano ani pliku, ani tresci");
        return;
      }
      try {
        const result = parseSource(
          name,
          data,
          formatKey === "auto" ? null : formatKey,
          { hasHeader: override === undefined ? hasHeader : override },
        );
        setParsed(result);
        setMapping(result.suggestedMapping);
        setNoteType(result.suggestedNoteType);

        // Talia z pliku: jesli istnieje o tej nazwie, wybierz ja; inaczej
        // zaproponuj utworzenie.
        const suggested = result.sourceDecks[0];
        if (suggested) {
          const existing = decks.find((deck) => deck.name === suggested);
          if (existing) {
            setDeckChoice(existing.id);
          } else {
            setDeckChoice(NEW_DECK);
            setNewDeckName(suggested);
          }
        }
      } catch (caught) {
        setParsed(null);
        setDrafts([]);
        setSummary(null);
        setError(
          caught instanceof ImportParseError || caught instanceof Error
            ? caught.message
            : "Nie udalo sie odczytac zrodla",
        );
      }
    },
    [pasted, fileName, formatKey, hasHeader, decks],
  );

  async function pickFile(file: File | null) {
    if (!file) return;
    fileData.current = new Uint8Array(await file.arrayBuffer());
    setFileName(file.name);
    setPasted("");
  }

  function toggleHeader(value: boolean | null) {
    setHasHeader(value);
    analyze(value);
  }

  async function commit() {
    if (!parsed || drafts.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let deckId = deckChoice;
      if (deckChoice === NEW_DECK) {
        if (!newDeckName.trim()) throw new Error("Podaj nazwe nowej talii");
        deckId = (await createDeck({ name: newDeckName.trim() })).id;
      }
      if (!deckId) throw new Error("Wybierz talie");

      const stats = await commitImport(deckId, drafts, { noteType, skipDuplicates });
      setDone({ ...stats, deckId });
      setParsed(null);
      setDrafts([]);
      setSummary(null);
      setPasted("");
      setFileName(null);
      fileData.current = null;
      setHasHeader(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import sie nie powiodl");
    } finally {
      setBusy(false);
    }
  }

  const canCommit =
    drafts.length > 0 && (deckChoice === NEW_DECK ? newDeckName.trim().length > 0 : !!deckChoice);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Import</h1>

      {done && (
        <section className="space-y-2 rounded-lg border border-emerald-600/40 bg-emerald-500/10 p-4">
          <p className="text-sm font-medium">
            Zaimportowano {done.imported}{" "}
            {done.imported === 1 ? "fiszke" : "fiszek"}
            {done.skippedDuplicates > 0 && ` · pominieto duplikatow: ${done.skippedDuplicates}`}
            {done.skippedInvalid > 0 && ` · niekompletnych: ${done.skippedInvalid}`}
          </p>
          <div className="flex gap-2">
            <Link
              href={`/nauka?talia=${done.deckId}`}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Ucz sie
            </Link>
            <Link
              href={`/fiszki?talia=${done.deckId}`}
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Zobacz fiszki
            </Link>
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 className="font-medium">Zrodlo</h2>

        <label className="block space-y-1">
          <span className="text-sm">Plik (fiszki/v1, CSV/TSV, tekst)</span>
          <input
            type="file"
            accept=".json,.csv,.tsv,.txt,.md"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
          />
          {fileName && <span className="block text-xs opacity-60">Wybrano: {fileName}</span>}
        </label>

        <label className="block space-y-1">
          <span className="text-sm">…albo wklej tresc</span>
          <textarea
            rows={5}
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              fileData.current = null;
              setFileName(null);
            }}
            placeholder={'kot - cat\npies - dog\n\nalbo CSV, albo JSON w formacie fiszki/v1'}
            className={`${inputClass} font-mono`}
          />
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1">
            <span className="text-sm">Format</span>
            <select
              value={formatKey}
              onChange={(e) => setFormatKey(e.target.value)}
              className={inputClass}
            >
              <option value="auto">Rozpoznaj automatycznie</option>
              {FORMATS.map((format) => (
                <option key={format.key} value={format.key}>
                  {format.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => analyze()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Analizuj
          </button>
        </div>

        <ErrorBanner message={error} />
      </section>

      {parsed && (
        <>
          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 className="font-medium">
              Rozpoznano: {FORMATS.find((f) => f.key === parsed.sourceFormat)?.label ?? parsed.sourceFormat}
              <span className="ml-2 text-sm font-normal opacity-60">
                pozycji: {drafts.length}
              </span>
            </h2>

            {parsed.warnings.length > 0 && (
              <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
                {parsed.warnings.map((warning, i) => (
                  <li key={i}>⚠ {warning}</li>
                ))}
              </ul>
            )}

            {parsed.sourceFormat === "csv" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hasHeader ?? parsed.warnings.some((w) => w.includes("naglowek:"))}
                  onChange={(e) => toggleHeader(e.target.checked)}
                />
                Pierwszy wiersz to naglowek, nie fiszka
              </label>
            )}

            {parsed.sourceFormat !== "fiszki-json" && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="opacity-60">
                    <tr>
                      <th className="py-1 pr-3 font-normal">Kolumna zrodla</th>
                      <th className="py-1 font-normal">Pole aplikacji</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.columns.map((column) => (
                      <tr key={column} className="border-t border-black/5 dark:border-white/10">
                        <td className="py-1.5 pr-3">{column}</td>
                        <td className="py-1.5">
                          <select
                            value={mapping[column] ?? "ignore"}
                            onChange={(e) =>
                              setMapping({ ...mapping, [column]: e.target.value })
                            }
                            className={inputClass}
                          >
                            {MAPPING_TARGETS.map((target) => (
                              <option key={target} value={target}>
                                {MAPPING_TARGET_LABELS[target] ?? target}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 className="font-medium">Podglad</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="opacity-60">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Przod</th>
                    <th className="py-1 pr-3 font-normal">Tyl</th>
                    <th className="py-1 pr-3 font-normal">Kategoria</th>
                    <th className="py-1 pr-3 font-normal">Karty</th>
                    <th className="py-1 font-normal">Tagi</th>
                  </tr>
                </thead>
                <tbody>
                  {preview(drafts).map((draft, index) => (
                    <tr key={index} className="border-t border-black/5 dark:border-white/10">
                      <td className="max-w-56 truncate py-1 pr-3">{draft.fields.Front}</td>
                      <td className="max-w-56 truncate py-1 pr-3">{draft.fields.Back}</td>
                      <td className="py-1 pr-3 opacity-70">
                        {ITEM_KIND_LABELS[draft.itemKind]}
                      </td>
                      <td className="py-1 pr-3 opacity-70">
                        {(draft.noteType ?? noteType) === "basic_reversed" ? "2" : "1"}
                        {draft.noteType && (
                          <span className="ml-1 text-xs opacity-60">z pliku</span>
                        )}
                      </td>
                      <td className="py-1 opacity-70">{draft.tags.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {drafts.length === 0 && (
              <p className="text-sm opacity-70">Przy tym mapowaniu nie powstaje zadna fiszka.</p>
            )}
            {drafts.length > preview(drafts).length && (
              <p className="text-xs opacity-50">
                …i jeszcze {drafts.length - preview(drafts).length} pozycji.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 className="font-medium">Zapis</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm">Talia</span>
                <select
                  value={deckChoice}
                  onChange={(e) => setDeckChoice(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— wybierz —</option>
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                    </option>
                  ))}
                  <option value={NEW_DECK}>+ nowa talia…</option>
                </select>
                {deckChoice === NEW_DECK && (
                  <input
                    value={newDeckName}
                    onChange={(e) => setNewDeckName(e.target.value)}
                    placeholder="Nazwa nowej talii"
                    className={inputClass}
                  />
                )}
              </label>

              <label className="block space-y-1">
                <span className="text-sm">Typ notatki</span>
                <select
                  value={noteType}
                  onChange={(e) => setNoteType(e.target.value as NoteType)}
                  className={inputClass}
                >
                  <option value="basic">Jednostronna (Przod → Tyl)</option>
                  <option value="basic_reversed">Dwustronna (oba kierunki)</option>
                </select>
                <span className="block text-xs opacity-60">
                  Typ podany przy pozycji w pliku wygrywa z tym ustawieniem.
                </span>
              </label>

              <label className="block space-y-1">
                <span className="text-sm">Kategoria materialu</span>
                <select
                  value={defaultKind}
                  onChange={(e) => setDefaultKind(e.target.value as ItemKind | "")}
                  className={inputClass}
                >
                  <option value="">Rozpoznaj z tresci</option>
                  {(Object.keys(ITEM_KIND_LABELS) as ItemKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      wszystko jako: {ITEM_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
                <span className="block text-xs opacity-60">
                  Wyrazen (idiomow) heurystyka nie rozpozna — ustaw recznie albo zmapuj kolumne.
                </span>
              </label>

              <label className="flex items-center gap-2 self-end text-sm">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                />
                Pomijaj duplikaty
              </label>
            </div>

            {summary && (
              <p className="text-sm opacity-70">
                Pozycji: {summary.total} · unikalnych: {summary.unique}
                {summary.duplicatesInFile > 0 && ` · powtorzen w pliku: ${summary.duplicatesInFile}`}
                {summary.alreadyInCollection > 0 && (
                  <span className="text-amber-700 dark:text-amber-300">
                    {" "}
                    · juz w kolekcji: {summary.alreadyInCollection}
                  </span>
                )}
              </p>
            )}

            <button
              type="button"
              disabled={!canCommit || busy}
              onClick={() => void commit()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Importuj{drafts.length > 0 ? ` (${drafts.length})` : ""}
            </button>
            {!canCommit && drafts.length > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Wybierz talie, do ktorej maja trafic fiszki.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
