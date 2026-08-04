"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppShell, ErrorBanner } from "@/components/AppShell";
import {
  DICTIONARY_DECK_ID,
  createDeck,
  ensureDictionary,
  isDictionary,
  listDecks,
  mergeDecks,
  type DeckCounts,
} from "@/lib/local/repo";
import type { DeckRecord } from "@/lib/local/types";

type DeckWithCounts = DeckRecord & { counts: DeckCounts };

/** Odmiana rzeczownika przez liczbe: 1 talia, 2 talie, 5 talii, 12 talii. */
function odmien(n: number, jedna: string, dwie: string, piec: string): string {
  const ostatnia = n % 10;
  const dwieOstatnie = n % 100;
  if (n === 1) return jedna;
  if (ostatnia >= 2 && ostatnia <= 4 && (dwieOstatnie < 12 || dwieOstatnie > 14)) return dwie;
  return piec;
}

export default function DecksPage() {
  return (
    <AppShell>
      <DeckList />
    </AppShell>
  );
}

function DeckList() {
  const [decks, setDecks] = useState<DeckWithCounts[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  //: Puste = uczymy sie ze wszystkiego. Zaznaczenie zawezasz do wybranych.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  //: Talia, w ktora maja sie zlac zaznaczone. Pusty = jeszcze nie wybrano.
  const [mergeInto, setMergeInto] = useState("");
  const [merging, setMerging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Slownik ma istniec od pierwszego otwarcia - to baza glowna.
      await ensureDictionary();
      setDecks(await listDecks());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie wczytac talii");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addDeck(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createDeck({ name: name.trim() });
      setName("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie dodac talii");
    } finally {
      setBusy(false);
    }
  }

  function toggle(deckId: string) {
    setMessage(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(deckId)) next.delete(deckId);
      else next.add(deckId);
      // Talia docelowa musi zostac wsrod zaznaczonych; a gdy w grze jest
      // Slownik, celem moze byc tylko on - zniknac mu nie wolno.
      if (next.has(DICTIONARY_DECK_ID)) setMergeInto(DICTIONARY_DECK_ID);
      else if (!next.has(mergeInto)) setMergeInto("");
      return next;
    });
  }

  async function merge() {
    if (!mergeInto || selected.size < 2) return;
    const target = decks?.find((deck) => deck.id === mergeInto);
    const others = [...selected].filter((id) => id !== mergeInto);
    if (
      !confirm(
        `Połączyć ${selected.size} ${odmien(selected.size, "talię", "talie", "talii")} ` +
          `w „${target?.name}”?\n\n` +
          "Fiszki i cała historia nauki zostaną przeniesione, a pozostałe talie znikną. " +
          "Tego nie da się cofnąć inaczej niż z kopii zapasowej.",
      )
    ) {
      return;
    }
    setMerging(true);
    setError(null);
    try {
      const wynik = await mergeDecks(mergeInto, others);
      setSelected(new Set());
      setMergeInto("");
      setMessage(
        `Połączono w „${wynik.deckName}”: przeniesiono ${wynik.movedNotes} ` +
          `${odmien(wynik.movedNotes, "fiszkę", "fiszki", "fiszek")} ` +
          `i ${wynik.movedReviews} ${odmien(wynik.movedReviews, "powtórkę", "powtórki", "powtórek")} ` +
          "z historii." +
          (wynik.duplicates > 0
            ? ` Uwaga: ${wynik.duplicates} ${odmien(wynik.duplicates, "fiszka powtarza", "fiszki powtarzają", "fiszek powtarza")} się w treści — nic nie usunięto.`
            : ""),
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie polaczyc talii");
    } finally {
      setMerging(false);
    }
  }

  // Bez zaznaczenia liczymy calosc; z zaznaczeniem tylko wybrane talie.
  const scope = decks?.filter((deck) => selected.size === 0 || selected.has(deck.id)) ?? [];
  const totals = scope.reduce(
    (sum, deck) => ({
      new: sum.new + deck.counts.new,
      due: sum.due + deck.counts.due,
      total: sum.total + deck.counts.total,
    }),
    { new: 0, due: 0, total: 0 },
  );
  const studyHref =
    selected.size === 0
      ? "/nauka?talia=wszystko"
      : `/nauka?talia=${[...selected].join(",")}`;
  const hasSomething = totals.new + totals.due > 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Talie</h1>

      {decks !== null && decks.length > 1 && (
        <section className="space-y-3 rounded-lg border border-indigo-600/30 bg-indigo-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {selected.size === 0
                  ? "Wszystko razem"
                  : `Wybrane talie (${selected.size})`}
              </p>
              <p className="mt-0.5 text-sm opacity-70">
                <span className="text-blue-600 dark:text-blue-400">{totals.new} nowych</span>
                {" · "}
                <span className="text-emerald-600 dark:text-emerald-400">
                  {totals.due} do powtorki
                </span>
                {" · "}
                {totals.total} kart
              </p>
            </div>
            <Link
              href={studyHref}
              aria-disabled={!hasSomething}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
                hasSomething
                  ? "bg-indigo-600 hover:bg-indigo-500"
                  : "pointer-events-none bg-indigo-600/40"
              }`}
            >
              Ucz sie
            </Link>
          </div>
          <p className="text-xs opacity-60">
            Karty ze wszystkich talii mieszaja sie w jedna kolejke, na przemian.
            Dzienne limity zostaja przy swoich taliach, wiec zadna nie zjada
            przydzialu innej.
            {selected.size > 0 && " Odznacz wszystkie, zeby wrocic do calosci."}
          </p>

          {selected.size >= 2 && (
            <div className="space-y-2 border-t border-indigo-600/20 pt-3">
              <p className="text-sm font-medium">Połącz zaznaczone w jedną talię</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={mergeInto}
                  onChange={(e) => setMergeInto(e.target.value)}
                  className="rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-white/20"
                >
                  <option value="">— zostaw nazwę talii —</option>
                  {decks
                    .filter((deck) => selected.has(deck.id))
                    // Slownik wsrod zaznaczonych = tylko on moze byc celem.
                    .filter(
                      (deck) => !selected.has(DICTIONARY_DECK_ID) || isDictionary(deck.id),
                    )
                    .map((deck) => (
                      <option key={deck.id} value={deck.id}>
                        {deck.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!mergeInto || merging}
                  onClick={() => void merge()}
                  className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-40"
                >
                  Połącz {selected.size} {odmien(selected.size, "talię", "talie", "talii")}
                </button>
              </div>
              <p className="text-xs opacity-60">
                Fiszki i historia nauki przechodzą do wybranej talii, pozostałe znikają.
                Stan powtórek każdej karty zostaje zachowany. Operacja nieodwracalna —
                warto najpierw zrobić kopię w Ustawieniach.
              </p>
            </div>
          )}
        </section>
      )}

      {message && (
        <p className="rounded-md border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm">
          {message}
        </p>
      )}

      <form onSubmit={addDeck} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nazwa nowej talii"
          className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-white/20"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Dodaj
        </button>
      </form>

      <ErrorBanner message={error} />

      {decks === null ? (
        <p className="text-sm opacity-70">Wczytywanie…</p>
      ) : decks.length === 0 ? (
        <p className="text-sm opacity-70">
          Nie masz jeszcze zadnej talii. Dodaj pierwsza powyzej albo wczytaj gotowa
          przez <Link href="/import" className="underline">Import</Link> — dane zostaja
          na tym urzadzeniu.
        </p>
      ) : (
        <ul className="space-y-2">
          {decks.map((deck) => (
            <li
              key={deck.id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/15"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {decks.length > 1 && (
                    <input
                      type="checkbox"
                      checked={selected.has(deck.id)}
                      onChange={() => toggle(deck.id)}
                      aria-label={`Wybierz talie ${deck.name}`}
                      className="mt-1.5"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {deck.name}
                      {isDictionary(deck.id) && (
                        <span className="ml-2 rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-normal text-indigo-700 dark:text-indigo-300">
                          baza główna
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm opacity-70">
                      <span className="text-blue-600 dark:text-blue-400">
                        {deck.counts.new} nowych
                      </span>
                      {" · "}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {deck.counts.due} do powtorki
                      </span>
                      {" · "}
                      {deck.counts.total} kart
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/fiszki?talia=${deck.id}`}
                    className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                  >
                    Fiszki
                  </Link>
                  <Link
                    href={`/nauka?talia=${deck.id}`}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Ucz sie
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
