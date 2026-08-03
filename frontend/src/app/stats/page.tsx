"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell, ErrorBanner } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  ITEM_KIND_LABELS,
  RATING_LABELS,
  type Deck,
  type ForecastPoint,
  type ItemKindStats,
  type LeechCard,
  type Overview,
  type Rating,
} from "@/lib/types";

const inputClass =
  "rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-white/20";

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} godz.`;
}

export default function StatsPage() {
  return (
    <AppShell>
      <Stats />
    </AppShell>
  );
}

function Stats() {
  const { user } = useAuth();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckId, setDeckId] = useState("");
  const [days, setDays] = useState(30);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [byKind, setByKind] = useState<ItemKindStats[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [leeches, setLeeches] = useState<LeechCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void api<Deck[]>("/decks")
      .then(setDecks)
      .catch(() => undefined);
  }, [user]);

  const load = useCallback(async () => {
    const scope = deckId ? `&deck_id=${deckId}` : "";
    try {
      const [o, k, f, l] = await Promise.all([
        api<Overview>(`/stats/overview?days=${days}${scope}`),
        api<ItemKindStats[]>(`/stats/by-item-kind?days=${Math.max(days, 90)}${scope}`),
        api<ForecastPoint[]>(`/stats/forecast?days=30${scope}`),
        api<LeechCard[]>(`/stats/leeches?limit=15${scope}`),
      ]);
      setOverview(o);
      setByKind(k);
      setForecast(f);
      setLeeches(l);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie wczytac statystyk");
    }
  }, [deckId, days]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Statystyki</h1>
        <div className="flex gap-2">
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)} className={inputClass}>
            <option value="">Wszystkie talie</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
              </option>
            ))}
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className={inputClass}
          >
            <option value={7}>7 dni</option>
            <option value={30}>30 dni</option>
            <option value={90}>90 dni</option>
            <option value={365}>rok</option>
          </select>
        </div>
      </div>

      <ErrorBanner message={error} />

      {overview === null ? (
        <p className="text-sm opacity-70">Wczytywanie…</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label={`Powtórki (${days} dni)`} value={overview.reviews.toLocaleString("pl")} />
            <Tile
              label="Skuteczność"
              value={percent(overview.retention)}
              hint={
                overview.retention_sample > 0
                  ? `z ${overview.retention_sample} powtórek`
                  : "brak danych"
              }
            />
            <Tile label="Passa" value={`${overview.streak_days} dni`} />
            <Tile
              label="Czas nauki"
              value={duration(overview.total_seconds)}
              hint={
                overview.seconds_per_review !== null
                  ? `${overview.seconds_per_review} s / fiszkę`
                  : undefined
              }
            />
          </section>

          <section className="space-y-2 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 className="font-medium">Skuteczność w rozbiciu</h2>
            <p className="text-sm opacity-70">
              Liczona tylko dla kart w stanie powtórki — „Znowu" w trakcie nauki to normalny krok,
              a nie porażka, więc nie zaniża wyniku.
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <Mini label="Ogółem" value={percent(overview.retention)} />
              <Mini label="Świeże (< 21 dni)" value={percent(overview.retention_young)} />
              <Mini label="Utrwalone (≥ 21 dni)" value={percent(overview.retention_mature)} />
            </dl>
            {overview.retention_sample > 0 && overview.retention_sample < 20 && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Próbka {overview.retention_sample} powtórek to jeszcze za mało, żeby traktować te
                liczby poważnie.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <div>
              <h2 className="font-medium">Według kategorii materiału</h2>
              <p className="text-sm opacity-70">
                To jest podstawa decyzji: jeśli zdania mają wyraźnie niższą skuteczność niż
                pojedyncze słowa, to sygnał, że wymagają innego traktowania — a nie po prostu
                większej liczby powtórek.
              </p>
            </div>

            {byKind.length === 0 ? (
              <p className="text-sm opacity-70">Brak fiszek.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="opacity-60">
                    <tr>
                      <th className="py-1 pr-3 font-normal">Kategoria</th>
                      <th className="py-1 pr-3 text-right font-normal">Karty</th>
                      <th className="py-1 pr-3 text-right font-normal">Nowe</th>
                      <th className="py-1 pr-3 text-right font-normal">Powtórki</th>
                      <th className="py-1 pr-3 text-right font-normal">Skuteczność</th>
                      <th className="py-1 pr-3 text-right font-normal">Stabilność</th>
                      <th className="py-1 pr-3 text-right font-normal">Trudność</th>
                      <th className="py-1 text-right font-normal">Wpadki</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byKind.map((row) => (
                      <tr
                        key={row.item_kind}
                        className="border-t border-black/5 dark:border-white/10"
                      >
                        <td className="py-1.5 pr-3">{ITEM_KIND_LABELS[row.item_kind]}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{row.cards}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums opacity-70">
                          {row.new_cards}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{row.reviews}</td>
                        <td
                          className="py-1.5 pr-3 text-right tabular-nums"
                          title={`próbka: ${row.retention_sample}`}
                        >
                          {row.retention === null ? (
                            <span className="opacity-50">za mało danych</span>
                          ) : (
                            percent(row.retention)
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums opacity-70">
                          {row.avg_stability_days === null ? "—" : `${row.avg_stability_days} d`}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums opacity-70">
                          {row.avg_difficulty ?? "—"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums opacity-70">{row.lapses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <h2 className="font-medium">Aktywność</h2>
            <BarChart
              points={overview.daily.map((d) => ({ label: d.day, value: d.reviews }))}
              empty="Jeszcze żadnych powtórek w tym okresie."
            />
            <div className="flex flex-wrap gap-3 text-sm opacity-70">
              {([1, 2, 3, 4] as Rating[]).map((rating) => (
                <span key={rating}>
                  {RATING_LABELS[rating]}: {overview.ratings[String(rating)] ?? 0}
                </span>
              ))}
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <div>
              <h2 className="font-medium">Prognoza obciążenia (30 dni)</h2>
              <p className="text-sm opacity-70">
                Kumulacja widoczna z wyprzedzeniem jest do rozładowania. Zauważona w dniu, w
                którym wypada — już nie.
              </p>
            </div>
            <BarChart
              points={forecast.map((f) => ({ label: f.day, value: f.count }))}
              empty="Nic nie czeka w kolejce."
            />
          </section>

          <section className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
            <div>
              <h2 className="font-medium">Materiał, który się nie klei</h2>
              <p className="text-sm opacity-70">
                Dużo wpadek przy niskiej stabilności zwykle nie znaczy „powtarzaj więcej", tylko
                „przeformułuj fiszkę" — za dużo treści naraz, myli się z inną albo brakuje
                kontekstu.
              </p>
            </div>
            {leeches.length === 0 ? (
              <p className="text-sm opacity-70">Nic się jeszcze nie zacięło.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {leeches.map((card) => (
                  <li
                    key={card.card_id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-t border-black/5 py-1.5 dark:border-white/10"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{card.front}</span>
                      <span className="opacity-60"> → {card.back}</span>
                      <span className="ml-2 text-xs opacity-50">
                        {ITEM_KIND_LABELS[card.item_kind]} · {card.deck_name}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums opacity-70">
                      {card.lapses} wpadek / {card.reps} powtórek
                      {card.is_leech && (
                        <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-xs text-rose-700 dark:text-rose-300">
                          do przeformułowania
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
      <p className="text-xs opacity-60">{label}</p>
      <p className="mt-0.5 text-xl font-medium tabular-nums">{value}</p>
      {hint && <p className="text-xs opacity-50">{hint}</p>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-black/5 px-3 py-2 dark:bg-white/10">
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="text-base font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function BarChart({
  points,
  empty,
}: {
  points: { label: string; value: number }[];
  empty: string;
}) {
  if (points.length === 0) {
    return <p className="text-sm opacity-70">{empty}</p>;
  }
  const max = Math.max(...points.map((p) => p.value), 1);

  return (
    <div className="flex h-28 items-end gap-0.5 overflow-x-auto">
      {points.map((point) => (
        <div
          key={point.label}
          title={`${point.label}: ${point.value}`}
          className="flex min-w-[6px] flex-1 flex-col justify-end"
        >
          <div
            className="rounded-t bg-indigo-500/70"
            style={{ height: `${Math.max((point.value / max) * 100, 2)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
