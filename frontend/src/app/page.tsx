"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  AppShell,
  ErrorBanner,
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from "@/components/AppShell";
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
import { odmien } from "@/lib/types";

type DeckWithCounts = DeckRecord & { counts: DeckCounts };

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
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  //: Puste = uczymy sie ze wszystkiego. Zaznaczenie zawezasz do wybranych.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  //: Talia, w ktora maja sie zlac zaznaczone.
  const [mergeInto, setMergeInto] = useState("");
  const [merging, setMerging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Slownik ma istniec od pierwszego otwarcia - to baza glowna.
      await ensureDictionary();
      setDecks(await listDecks());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się wczytać talii");
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
      setAdding(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się dodać talii");
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
      setError(caught instanceof Error ? caught.message : "Nie udało się połączyć talii");
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
    selected.size === 0 ? "/nauka?talia=wszystko" : `/nauka?talia=${[...selected].join(",")}`;
  const hasSomething = totals.new + totals.due > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Talie</h1>
        {/* Najkrotsza droga do dopisania slowka w biegu. */}
        <Link
          href={`/fiszki?talia=${DICTIONARY_DECK_ID}`}
          className="flex items-center gap-1.5 text-sm font-medium text-accent"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Dodaj fiszkę
        </Link>
      </div>

      {decks !== null && decks.length > 1 && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[15px] font-medium">
                {selected.size === 0 ? "Wszystko razem" : `Wybrane talie (${selected.size})`}
              </p>
              <p className="mt-1.5 flex items-center gap-2.5 text-[13px] text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-[7px] w-[7px] rounded-full bg-accent" />
                  {totals.new} nowych
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-[7px] w-[7px] rounded-full bg-good" />
                  {totals.due} do powtórki
                </span>
              </p>
            </div>
            <Link
              href={studyHref}
              aria-disabled={!hasSomething}
              className={`rounded-lg px-[18px] py-2.5 text-sm font-medium text-white ${
                hasSomething
                  ? "bg-accent hover:bg-accent-hover"
                  : "pointer-events-none bg-accent/40"
              }`}
            >
              Ucz się
            </Link>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            Karty ze wszystkich talii mieszają się w jedną kolejkę, na przemian. Dzienne
            limity zostają przy swoich taliach.
            {selected.size > 0 && " Odznacz wszystkie, żeby wrócić do całości."}
          </p>

          {selected.size >= 2 && (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <p className="text-sm font-medium">Połącz zaznaczone w jedną talię</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={mergeInto}
                  onChange={(e) => setMergeInto(e.target.value)}
                  className="rounded-lg border border-field bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
                >
                  <option value="">— zostaw nazwę talii —</option>
                  {decks
                    .filter((deck) => selected.has(deck.id))
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
                  className="rounded-lg bg-again px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  Połącz {selected.size} {odmien(selected.size, "talię", "talie", "talii")}
                </button>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">
                Fiszki i historia nauki przechodzą do wybranej talii, pozostałe znikają.
                Operacja nieodwracalna — warto najpierw zrobić kopię.
              </p>
            </div>
          )}
        </section>
      )}

      {message && (
        <p className="rounded-lg border border-good-line bg-good-bg px-3 py-2.5 text-sm text-good">
          {message}
        </p>
      )}

      <ErrorBanner message={error} />

      {decks === null ? (
        <p className="text-sm text-ink-2">Wczytywanie…</p>
      ) : (
        <>
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs tracking-[0.01em] text-ink-3">TWOJE TALIE</p>
            {!adding && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="text-[13px] text-ink-2 hover:text-ink"
              >
                + nowa talia
              </button>
            )}
          </div>

          {adding && (
            <form onSubmit={addDeck} className="flex gap-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nazwa nowej talii"
                className={inputClass}
              />
              <button type="submit" disabled={busy} className={buttonClass}>
                Dodaj
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setName("");
                }}
                className={secondaryButtonClass}
              >
                Anuluj
              </button>
            </form>
          )}

          {decks.length === 0 ? (
            <p className="text-sm text-ink-2">
              Nie masz jeszcze żadnej talii. Wczytaj gotową przez{" "}
              <Link href="/import" className="text-accent underline">
                Import
              </Link>{" "}
              — dane zostają na tym urządzeniu.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {decks.map((deck) => (
                <li key={deck.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-start gap-3">
                    {decks.length > 1 && (
                      <input
                        type="checkbox"
                        checked={selected.has(deck.id)}
                        onChange={() => toggle(deck.id)}
                        aria-label={`Wybierz talię ${deck.name}`}
                        className="mt-1 h-[18px] w-[18px] accent-[var(--color-accent)]"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                        <span className="break-words">{deck.name}</span>
                        {isDictionary(deck.id) && (
                          <span className="rounded bg-accent-soft px-[7px] py-0.5 text-[11px] font-medium text-accent">
                            baza główna
                          </span>
                        )}
                      </p>
                      <p className="mt-1.5 text-[13px] text-ink-2">
                        {deck.counts.new} nowych · {deck.counts.due} do powtórki ·{" "}
                        {deck.counts.total} kart
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Link
                      href={`/fiszki?talia=${deck.id}`}
                      className="flex-1 rounded-lg border border-line py-2.5 text-center text-sm font-medium hover:border-field"
                    >
                      Fiszki
                    </Link>
                    <Link
                      href={`/nauka?talia=${deck.id}`}
                      className="flex-1 rounded-lg bg-accent py-2.5 text-center text-sm font-medium text-on-accent hover:bg-accent-hover"
                    >
                      Ucz się
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
