"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { AppShell, ErrorBanner, inputClass } from "@/components/AppShell";
import {
  FORMATS,
  MAPPING_TARGETS,
  type ParseResult,
  parseSource,
} from "@/lib/local/import";
import {
  type CommitStats,
  type DuplicateMode,
  type DuplicateSummary,
  type NoteDraft,
  commitImport,
  duplicateSummary,
  normalize,
  preview,
} from "@/lib/local/import/service";
import {
  DICTIONARY_DECK_ID,
  createDeck,
  ensureDictionary,
  isDictionary,
  listDecks,
  naprawPrzyklady,
} from "@/lib/local/repo";
import type { DeckRecord } from "@/lib/local/types";
import {
  ITEM_KIND_LABELS,
  MAPPING_TARGET_LABELS,
  odmien,
  type ItemKind,
  type NoteType,
} from "@/lib/types";

const NEW_DECK = "__new__";

/**
 * Instrukcja do wklejenia w rozmowie z Claude'em (albo w innym generatorze).
 *
 * Aplikacja niesie wlasna specyfikacje formatu, bo czat na telefonie to
 * osobne srodowisko - nie ma dostepu do pamieci ani do repozytorium i sam
 * z siebie nie wie, czego oczekuje import. Zamiast liczyc na to, ze
 * uzytkownik zapamieta format, dajemy mu go pod przyciskiem.
 *
 * Trzymane w kodzie, nie w pliku - ma dzialac offline.
 */
const CLAUDE_PROMPT = `Zrób z tego fiszki w formacie JSON "fiszki/v1". Zasady:

{
  "format": "fiszki/v1",
  "notes": [
    {
      "front": "strona pytania (obcy język)",
      "back": "strona odpowiedzi (polski)",
      "example": "zdanie przykładowe — opcjonalne",
      "pronunciation": "/wymowa IPA/ — opcjonalne",
      "synonyms": "synonim / inny synonim — opcjonalne",
      "formal": "odpowiednik formalny — opcjonalne",
      "tags": ["tag1", "tag2"],
      "kind": "word | phrase | expression | sentence",
      "note_type": "basic | basic_reversed"
    }
  ]
}

- Wymagane są tylko "front" i "back". Nigdy puste.
- "example" MUSI zawierać uczony zwrot — zdanie na temat, ale bez samego
  zwrotu, jest do nauki bezużyteczne. Zwrot może być odmieniony ("to fob
  someone off" → "The council keeps fobbing me off"), a placeholdery
  someone/something zastąp konkretem. Przepisz z materiału; gdy go tam nie
  ma, zostaw pole puste.
- NIE wklejaj synonimów, wymowy ani odpowiednika formalnego do "example".
  Każde z nich ma własne pole; wklejone w przykład zaśmiecają zdanie i nie
  dają się użyć osobno. Człony list rozdzielaj ukośnikiem ZE SPACJAMI: "a / b".
- "synonyms" to wyrażenia WYMIENNE w zdaniu, nie definicje — z tego pola
  powstaje pytanie karty „opis → termin", więc definicja zawierająca sam
  termin zdradza odpowiedź.
- NIE dodawaj pola "deck" ani nie wymyślaj nazw talii — materiał trafia do
  jednej wspólnej bazy.
- "kind": pojedyncze słowo → word; kilka słów dosłownie → phrase; idiom albo
  zwrot, którego znaczenia nie da się złożyć ze słów → expression; pełne
  zdanie → sentence. Oznacz "expression" sam — tego nie da się zgadnąć
  automatycznie, a ma znaczenie dla statystyk.
- "note_type": słowa i frazy → basic_reversed (uczę się w obie strony);
  zdania i zwroty do rozpoznawania → basic.
- Odpowiedz SAMYM JSON-em, bez komentarza i bez ogrodzeń \`\`\`.
- Korzystaj wyłącznie z treści, którą podaję. Czego nie ma — nie zgaduj,
  tylko wypisz na końcu, czego nie dało się przenieść.

Jeśli to poprawiona wersja materiału, który już mam: wygeneruj CAŁY plik od
nowa (nie tylko zmiany). Przy imporcie wybiorę „Uzupełnij o to, co jest
w pliku" — istniejące fiszki dostaną nowe przykłady i tagi, a ich stan
powtórek zostanie nietknięty.`;

export default function ImportPage() {
  return (
    <AppShell>
      {/* Granica Suspense - useSearchParams przy eksporcie statycznym. */}
      <Suspense fallback={<p className="text-sm text-ink-2">Wczytywanie…</p>}>
        <Importer />
      </Suspense>
    </AppShell>
  );
}

function Importer() {
  // Tresc z systemowego "Udostepnij" (Android share target, manifest) -
  // np. fiszki wygenerowane w aplikacji Claude, wyslane tu jednym kliknieciem.
  const shared = useSearchParams().get("udostepnione");

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
  // Material z zewnatrz trafia domyslnie do Slownika (bazy glownej) -
  // osobna talia to swiadomy wybor, nie efekt uboczny wgrania pliku.
  const [deckChoice, setDeckChoice] = useState<string>(DICTIONARY_DECK_ID);
  const [newDeckName, setNewDeckName] = useState("");
  const [noteType, setNoteType] = useState<NoteType>("basic");
  const [defaultKind, setDefaultKind] = useState<ItemKind | "">("");
  // Domyslnie "skip": import tylko dokłada nowy material. Aktualizacja
  // istniejacych to swiadomy wybor, bo nadpisuje tresc.
  const [onDuplicate, setOnDuplicate] = useState<DuplicateMode>("skip");

  const [done, setDone] = useState<(CommitStats & { deckId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(CLAUDE_PROMPT);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 3000);
    } catch {
      // Schowek bywa niedostepny (brak zgody, stara przegladarka) - wtedy
      // pokazujemy tresc do recznego zaznaczenia zamiast udawac sukces.
      setPromptVisible(true);
    }
  }

  useEffect(() => {
    void (async () => {
      await ensureDictionary();
      setDecks(await listDecks());
    })();
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
    (options?: { header?: boolean | null; content?: string }) => {
      setError(null);
      setDone(null);
      // `content` pozwala analizowac tresc, ktora dopiero co trafila do stanu
      // (auto-analiza po "Udostepnij") - setPasted nie zdazyloby jej domknac.
      const data =
        options?.content !== undefined
          ? new TextEncoder().encode(options.content)
          : (fileData.current ?? new TextEncoder().encode(pasted));
      // Schowek celowo bez rozszerzenia: o formacie wklejonej tresci ma
      // decydowac zawartosc, nie zmyslona nazwa pliku. Z ".txt" wklejony
      // CSV szedlby sciezka zwyklego tekstu i rozpadal sie na pierwszym
      // sredniku.
      const name = options?.content !== undefined ? "schowek" : (fileName ?? "schowek");
      if (data.length === 0) {
        setError("Nie przesłano ani pliku, ani treści");
        return;
      }
      try {
        const result = parseSource(
          name,
          data,
          formatKey === "auto" ? null : formatKey,
          { hasHeader: options?.header === undefined ? hasHeader : options.header },
        );
        setParsed(result);
        setMapping(result.suggestedMapping);
        setNoteType(result.suggestedNoteType);

        // Nazwa talii z pliku NIE tworzy nowej grupy - material domyslnie
        // rozplywa sie w Slowniku. Zostaje tylko jako podpowiedz, gdyby
        // uzytkownik swiadomie wybral "+ nowa talia".
        setNewDeckName(result.sourceDecks[0] ?? "");
      } catch (caught) {
        setParsed(null);
        setDrafts([]);
        setSummary(null);
        setError(
          caught instanceof Error ? caught.message : "Nie udało się odczytać źródła",
        );
      }
    },
    [pasted, fileName, formatKey, hasHeader],
  );

  // Bez wyzerowania pole pamieta ostatni plik i ponowny wybor tego samego
  // pliku nie wywoluje zdarzenia - import "raz Pomin, raz Uzupelnij" bylby
  // niemozliwy bez przeladowania strony.
  const fileInput = useRef<HTMLInputElement>(null);
  function clearFile() {
    fileData.current = null;
    setFileName(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function pickFile(file: File | null) {
    if (!file) return;
    fileData.current = new Uint8Array(await file.arrayBuffer());
    setFileName(file.name);
    setPasted("");
  }

  function toggleHeader(value: boolean | null) {
    setHasHeader(value);
    analyze({ header: value });
  }

  // Tresc z "Udostepnij" wchodzi do pola i od razu do analizy - uzytkownik
  // widzi podglad i sam decyduje o imporcie. Auto-importu celowo nie ma:
  // podsumowanie duplikatow ma byc widoczne PRZED zapisem.
  const sharedHandled = useRef(false);
  useEffect(() => {
    if (!shared || sharedHandled.current) return;
    sharedHandled.current = true;
    setPasted(shared);
    fileData.current = null;
    setFileName(null);
    analyze({ content: shared });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  async function commit() {
    if (!parsed || drafts.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let deckId = deckChoice;
      if (deckChoice === NEW_DECK) {
        if (!newDeckName.trim()) throw new Error("Podaj nazwę nowej talii");
        deckId = (await createDeck({ name: newDeckName.trim() })).id;
      }
      if (!deckId) throw new Error("Wybierz talię");

      const stats = await commitImport(deckId, drafts, { noteType, onDuplicate });
      // Stare pliki z czatu maja adnotacje sklejone w przykladzie.
      await naprawPrzyklady().catch(() => undefined);
      setDone({ ...stats, deckId });
      // Nastepny import znow celuje w baze glowna - "+ osobna talia" nie ma
      // sie utrwalac jako nowy stan domyslny.
      setDeckChoice(DICTIONARY_DECK_ID);
      setParsed(null);
      setDrafts([]);
      setSummary(null);
      setPasted("");
      clearFile();
      setHasHeader(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import się nie powiódł");
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
        <section className="space-y-2 rounded-xl border border-good-line bg-good-bg p-4">
          <p className="text-sm font-medium">
            {done.imported > 0 &&
              `Dodano ${done.imported} ${odmien(done.imported, "fiszkę", "fiszki", "fiszek")}`}
            {done.imported > 0 && done.updated > 0 && " · "}
            {done.updated > 0 &&
              `uzupełniono ${done.updated} ${odmien(done.updated, "fiszkę", "fiszki", "fiszek")}`}
            {done.imported === 0 && done.updated === 0 && "Nic nie wymagało zmiany"}
            {done.skippedDuplicates > 0 && ` · pominięto duplikatów: ${done.skippedDuplicates}`}
            {done.skippedInvalid > 0 && ` · niekompletnych: ${done.skippedInvalid}`}
          </p>
          <div className="flex gap-2">
            <Link
              href={`/nauka?talia=${done.deckId}`}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
            >
              Ucz się
            </Link>
            <Link
              href={`/fiszki?talia=${done.deckId}`}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-field"
            >
              Zobacz fiszki
            </Link>
          </div>
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-line bg-accent-soft p-4">
        <h2 className="font-medium">Nowe fiszki od Claude&apos;a</h2>
        <p className="text-sm text-ink-2">
          Czat nie zna formatu tej aplikacji. Skopiuj instrukcję,
          wklej ją w rozmowie razem ze zdjęciem albo listą słówek — wynik wróci
          tu gotowy do importu.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyPrompt()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            {promptCopied ? "Skopiowano ✓" : "Skopiuj instrukcję dla Claude'a"}
          </button>
          <button
            type="button"
            onClick={() => setPromptVisible((v) => !v)}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-field"
          >
            {promptVisible ? "Ukryj" : "Pokaż treść"}
          </button>
        </div>
        {promptVisible && (
          <textarea
            readOnly
            rows={10}
            value={CLAUDE_PROMPT}
            onFocus={(e) => e.currentTarget.select()}
            className={`${inputClass} font-mono text-xs`}
          />
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-medium">Źródło</h2>

        <label className="block space-y-1">
          <span className="text-sm">Plik (fiszki/v1, CSV/TSV, tekst)</span>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.csv,.tsv,.txt,.md"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-canvas file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-ink hover:file:border-field"
          />
          {fileName && <span className="block text-xs text-ink-3">Wybrano: {fileName}</span>}
        </label>

        <label className="block space-y-1">
          <span className="text-sm">…albo wklej treść</span>
          <textarea
            rows={5}
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              clearFile();
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
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Analizuj
          </button>
        </div>

        <ErrorBanner message={error} />
      </section>

      {parsed && (
        <>
          <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <h2 className="font-medium">
              Rozpoznano: {FORMATS.find((f) => f.key === parsed.sourceFormat)?.label ?? parsed.sourceFormat}
              <span className="ml-2 text-sm font-normal text-ink-3">
                pozycji: {drafts.length}
              </span>
            </h2>

            {parsed.warnings.length > 0 && (
              <ul className="space-y-1 text-[13px] text-hard">
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
                Pierwszy wiersz to nagłówek, nie fiszka
              </label>
            )}

            {parsed.sourceFormat !== "fiszki-json" && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-ink-3">
                    <tr>
                      <th className="py-1.5 pr-3 font-normal">Kolumna źródła</th>
                      <th className="py-1.5 font-normal">Pole aplikacji</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.columns.map((column) => (
                      <tr key={column} className="border-t border-line-soft">
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

          <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <h2 className="font-medium">Podgląd</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-ink-3">
                  <tr>
                    <th className="py-1.5 pr-3 font-normal">Przód</th>
                    <th className="py-1.5 pr-3 font-normal">Tył</th>
                    <th className="py-1.5 pr-3 font-normal">Kategoria</th>
                    <th className="py-1.5 pr-3 font-normal">Karty</th>
                    <th className="py-1.5 font-normal">Tagi</th>
                  </tr>
                </thead>
                <tbody>
                  {preview(drafts).map((draft, index) => (
                    <tr key={index} className="border-t border-line-soft">
                      <td className="max-w-56 truncate py-1.5 pr-3">{draft.fields.Front}</td>
                      <td className="max-w-56 truncate py-1.5 pr-3">{draft.fields.Back}</td>
                      <td className="py-1.5 pr-3 text-ink-2">
                        {ITEM_KIND_LABELS[draft.itemKind]}
                      </td>
                      <td className="py-1.5 pr-3 text-ink-2">
                        {(draft.noteType ?? noteType) === "basic_reversed" ? "2" : "1"}
                        {draft.noteType && (
                          <span className="ml-1 text-xs text-ink-3">z pliku</span>
                        )}
                      </td>
                      <td className="py-1.5 text-ink-2">{draft.tags.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {drafts.length === 0 && (
              <p className="text-sm text-ink-2">Przy tym mapowaniu nie powstaje żadna fiszka.</p>
            )}
            {drafts.length > preview(drafts).length && (
              <p className="text-xs text-ink-4">
                …i jeszcze {drafts.length - preview(drafts).length} pozycji.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <h2 className="font-medium">Zapis</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm">Talia</span>
                <select
                  value={deckChoice}
                  onChange={(e) => setDeckChoice(e.target.value)}
                  className={inputClass}
                >
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {isDictionary(deck.id) ? `${deck.name} — baza główna` : deck.name}
                    </option>
                  ))}
                  <option value={NEW_DECK}>+ osobna talia…</option>
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
                  <option value="basic">Jednostronna (przód → tył)</option>
                  <option value="basic_reversed">Dwustronna (oba kierunki)</option>
                </select>
                <span className="block text-xs text-ink-3">
                  Typ podany przy pozycji w pliku wygrywa z tym ustawieniem.
                </span>
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
                <span className="block text-xs text-ink-3">
                  Wyrażeń (idiomów) heurystyka nie rozpozna — ustaw ręcznie albo zmapuj kolumnę.
                </span>
              </label>

              <label className="block space-y-1">
                <span className="text-sm">Gdy fiszka już jest w kolekcji</span>
                <select
                  value={onDuplicate}
                  onChange={(e) => setOnDuplicate(e.target.value as DuplicateMode)}
                  className={inputClass}
                >
                  <option value="skip">Pomiń — nie ruszaj istniejącej</option>
                  <option value="update">Uzupełnij o to, co jest w pliku</option>
                  <option value="add">Dodaj jako osobną fiszkę</option>
                </select>
                <span className="block text-xs text-ink-3">
                  {onDuplicate === "update"
                    ? "Dopisuje przykład, tagi i kategorię. Nie kasuje tego, czego plik nie ma, i nie rusza stanu powtórek ani liczby kart."
                    : onDuplicate === "add"
                      ? "Powstanie druga fiszka o tej samej treści — zwykle niepożądane."
                      : "Duplikaty rozpoznawane po przodzie i tyle, niezależnie od formatowania."}
                </span>
              </label>
            </div>

            {summary && (
              <p className="text-sm text-ink-2">
                Pozycji: {summary.total} · unikalnych: {summary.unique}
                {summary.duplicatesInFile > 0 && ` · powtórzeń w pliku: ${summary.duplicatesInFile}`}
                {summary.alreadyInCollection > 0 && (
                  <span className="text-hard">
                    {" "}
                    · już w kolekcji: {summary.alreadyInCollection}
                  </span>
                )}
              </p>
            )}

            <button
              type="button"
              disabled={!canCommit || busy}
              onClick={() => void commit()}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              Importuj{drafts.length > 0 ? ` (${drafts.length})` : ""}
            </button>
            {!canCommit && drafts.length > 0 && (
              <p className="text-[13px] text-hard">
                Wybierz talię, do której mają trafić fiszki.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
