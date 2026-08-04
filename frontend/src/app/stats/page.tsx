"use client";

import { useEffect, useState } from "react";

import { AppShell, ErrorBanner } from "@/components/AppShell";
import {
  MIN_REVIEWS_FOR_SIGNAL,
  byItemKind,
  byTag,
  forecast,
  leeches,
  overview,
  studyDay,
  type ForecastPoint,
  type ItemKindStats,
  type LeechCard,
  type Overview,
  type TagStats,
} from "@/lib/local/stats";
import { ITEM_KIND_LABELS, RATING_LABELS, type Rating } from "@/lib/types";

const inputClass =
  "rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-white/20";

const PERIODS = [
  { days: 7, label: "7 dni" },
  { days: 30, label: "30 dni" },
  { days: 90, label: "90 dni" },
  { days: 365, label: "rok" },
];

//: Kolory ocen z ekranu nauki. Para bursztyn-szmaragd siedzi w pasie CVD
//: 6-8 (walidator), wiec kolor nigdy nie niesie tozsamosci sam - kazda
//: ocena ma obok etykiete tekstowa.
const RATING_DOTS: Record<Rating, string> = {
  1: "bg-rose-600",
  2: "bg-amber-600",
  3: "bg-emerald-600",
  4: "bg-sky-600",
};

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} godz.`;
}

function shortDay(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

export default function StatsPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{
    overview: Overview;
    kinds: ItemKindStats[];
    tags: TagStats[];
    problems: LeechCard[];
    load: ForecastPoint[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [ov, kinds, tags, problems, load] = await Promise.all([
          overview({ days }),
          byItemKind({ days }),
          byTag({ days, limit: 12 }),
          leeches({ limit: 10 }),
          forecast({ days: 14 }),
        ]);
        if (!cancelled) setData({ overview: ov, kinds, tags, problems, load });
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Nie udalo sie policzyc statystyk");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <p className="text-sm opacity-70">Liczenie…</p>;

  const { overview: ov } = data;
  const today = studyDay(new Date());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Statystyki</h1>
        <label className="flex items-center gap-2 text-sm opacity-80">
          Okres
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className={inputClass}
          >
            {PERIODS.map((period) => (
              <option key={period.days} value={period.days}>
                {period.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* --- kafle przegladu --- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Powtorki" value={String(ov.reviews)} hint={`łącznie: ${ov.reviewsAllTime}`} />
        <StatTile
          label="Skutecznosc"
          value={percent(ov.retention)}
          hint={
            ov.retentionSample > 0
              ? `próba: ${ov.retentionSample}${ov.retentionSample < MIN_REVIEWS_FOR_SIGNAL ? " (mało!)" : ""}`
              : "jeszcze bez kart nauczonych"
          }
        />
        <StatTile
          label="Passa"
          value={`${ov.streakDays} ${ov.streakDays === 1 ? "dzień" : "dni"}`}
          hint="kolejne dni nauki"
        />
        <StatTile
          label="Czas nauki"
          value={duration(ov.totalSeconds)}
          hint={ov.secondsPerReview !== null ? `${ov.secondsPerReview} s / powtórkę` : "—"}
        />
      </div>

      {(ov.retentionYoung !== null || ov.retentionMature !== null) && (
        <p className="text-sm opacity-70">
          Materiał świeży: <strong>{percent(ov.retentionYoung)}</strong> · utrwalony:{" "}
          <strong>{percent(ov.retentionMature)}</strong>{" "}
          <span className="opacity-60">(granica: stabilność 21 dni)</span>
        </p>
      )}

      {/* --- kategorie materialu --- */}
      <section className="space-y-2">
        <h2 className="font-medium">Kategorie materiału</h2>
        {data.kinds.length === 0 ? (
          <p className="text-sm opacity-70">Brak materiału — dodaj albo zaimportuj fiszki.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
            <table className="w-full text-left text-sm">
              <thead className="opacity-60">
                <tr>
                  <th className="px-3 py-2 font-normal">Kategoria</th>
                  <th className="px-3 py-2 font-normal">Karty</th>
                  <th className="px-3 py-2 font-normal">Nowe</th>
                  <th className="px-3 py-2 font-normal">Powtórki</th>
                  <th className="px-3 py-2 font-normal">Skuteczność</th>
                  <th className="px-3 py-2 font-normal">Stabilność</th>
                  <th className="px-3 py-2 font-normal">Wpadki</th>
                </tr>
              </thead>
              <tbody>
                {data.kinds.map((row) => (
                  <tr key={row.itemKind} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-3 py-2">{ITEM_KIND_LABELS[row.itemKind]}</td>
                    <td className="px-3 py-2">{row.cards}</td>
                    <td className="px-3 py-2 opacity-70">{row.newCards}</td>
                    <td className="px-3 py-2">{row.reviews}</td>
                    <td className="px-3 py-2">
                      {percent(row.retention)}
                      {row.retention === null && row.retentionSample > 0 && (
                        <span className="ml-1 text-xs opacity-50">
                          (próba: {row.retentionSample})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 opacity-70">
                      {row.avgStabilityDays !== null ? `${row.avgStabilityDays} dni` : "—"}
                    </td>
                    <td className="px-3 py-2 opacity-70">{row.lapses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs opacity-50">
          Skuteczność pokazuje się od {MIN_REVIEWS_FOR_SIGNAL} powtórek kart nauczonych —
          mniejsza próba to szum, nie sygnał.
        </p>
      </section>

      {/* --- aktywnosc --- */}
      <section className="space-y-2">
        <h2 className="font-medium">Aktywność — powtórki dziennie</h2>
        {ov.daily.length === 0 ? (
          <p className="text-sm opacity-70">W tym okresie nie było powtórek.</p>
        ) : (
          <Bars
            points={ov.daily.map((d) => ({
              day: d.day,
              count: d.reviews,
              title: `${shortDay(d.day)}: ${d.reviews} powtórek, ${duration(d.seconds)}${
                d.retention !== null ? `, skuteczność ${percent(d.retention)}` : ""
              }`,
            }))}
          />
        )}
      </section>

      {/* --- prognoza --- */}
      <section className="space-y-2">
        <h2 className="font-medium">Prognoza — karty do powtórki (14 dni)</h2>
        {data.load.length === 0 ? (
          <p className="text-sm opacity-70">Nic nie czeka w kolejce.</p>
        ) : (
          <>
            <Bars
              points={data.load.map((p) => ({
                day: p.day,
                count: p.count,
                title: `${shortDay(p.day)}: ${p.count} kart${p.day < today ? " (zaległe)" : ""}`,
              }))}
            />
            {data.load.some((p) => p.day < today) && (
              <p className="text-xs opacity-50">Dni przed dzisiejszym to zaległości.</p>
            )}
          </>
        )}
      </section>

      {/* --- oceny --- */}
      {ov.reviews > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Rozkład ocen</h2>
          <div className="flex flex-wrap gap-3 text-sm">
            {([1, 2, 3, 4] as Rating[]).map((rating) => (
              <span key={rating} className="flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${RATING_DOTS[rating]}`} />
                {RATING_LABELS[rating]}: <strong>{ov.ratings[String(rating)] ?? 0}</strong>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* --- tagi --- */}
      {data.tags.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Tagi</h2>
          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
            <table className="w-full text-left text-sm">
              <thead className="opacity-60">
                <tr>
                  <th className="px-3 py-2 font-normal">Tag</th>
                  <th className="px-3 py-2 font-normal">Karty</th>
                  <th className="px-3 py-2 font-normal">Powtórki</th>
                  <th className="px-3 py-2 font-normal">Skuteczność</th>
                </tr>
              </thead>
              <tbody>
                {data.tags.map((row) => (
                  <tr key={row.tag} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-3 py-2">{row.tag}</td>
                    <td className="px-3 py-2 opacity-70">{row.cards}</td>
                    <td className="px-3 py-2">{row.reviews}</td>
                    <td className="px-3 py-2">{percent(row.retention)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* --- material problematyczny --- */}
      <section className="space-y-2">
        <h2 className="font-medium">Do przeformułowania</h2>
        {data.problems.length === 0 ? (
          <p className="text-sm opacity-70">Nic się uporczywie nie myli. Tak trzymać.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {data.problems.map((card) => (
                <li
                  key={card.cardId}
                  className="rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/15"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0">
                      <strong className="break-words">{card.front}</strong>
                      <span className="opacity-60"> → {card.back}</span>
                    </span>
                    <span className="shrink-0 text-xs opacity-60">
                      {card.lapses} wpadek / {card.reps} powtórek
                      {card.isLeech && (
                        <strong className="ml-1 text-rose-700 dark:text-rose-300">pijawka</strong>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs opacity-50">
              Dużo wpadek zwykle nie znaczy „powtarzaj więcej", tylko „fiszka jest źle
              sformułowana" — za dużo naraz, myli się z inną, brak kontekstu.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
      <p className="text-xs uppercase tracking-wide opacity-50">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs opacity-60">{hint}</p>
    </div>
  );
}

/**
 * Slupki dzienne: jedna seria, jeden odcien (tozsamosc niesie tytul sekcji,
 * nie kolor). Cienkie znaczniki, zaokraglony koniec danych, 2px odstepu,
 * podpowiedz na najechanie, rzadkie etykiety osi.
 */
function Bars({ points }: { points: Array<{ day: string; count: number; title: string }> }) {
  const max = Math.max(...points.map((p) => p.count), 1);
  return (
    <div>
      <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="Wykres słupkowy">
        {points.map((point) => (
          <div
            key={point.day}
            title={point.title}
            className="flex h-full flex-1 flex-col justify-end"
          >
            <div
              className="rounded-t bg-indigo-600 dark:bg-indigo-500"
              style={{ height: `${Math.max((point.count / max) * 100, point.count > 0 ? 3 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between border-t border-black/10 pt-1 text-xs opacity-50 dark:border-white/10">
        <span>{shortDay(points[0].day)}</span>
        {points.length > 1 && <span>{shortDay(points[points.length - 1].day)}</span>}
      </div>
    </div>
  );
}
