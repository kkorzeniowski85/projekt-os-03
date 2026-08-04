"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppShell, ErrorBanner } from "@/components/AppShell";
import { createDeck, listDecks, type DeckCounts } from "@/lib/local/repo";
import type { DeckRecord } from "@/lib/local/types";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Talie</h1>

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
          Nie masz jeszcze zadnej talii. Dodaj pierwsza powyzej - dane zostaja
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
                <div>
                  <p className="font-medium">{deck.name}</p>
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
                <div className="flex gap-2">
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
