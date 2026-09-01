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
import { ITEM_KIND_LABELS, RATING_LABELS, odmien, type Rating } from "@/lib/types";

const PERIODS = [
  { days: 7, label: "7 dni" },
  { days: 30, label: "30 dni" },
  { days: 90, label: "90 dni" },
  { days: 365, label: "rok" },
];

//: Kolor ocen nigdy nie wystepuje sam - obok zawsze stoi etykieta.
const RATING_DOT: Record<Rating, string> = {
  1: "bg-again",
  2: "bg-hard",
  3: "bg-good",
  4: "bg-easy",
};

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1).replace(".", ",")} godz.`;
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
          setError(caught instanceof Error ? caught.message : "Nie udało się policzyć statystyk");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <p className="text-sm text-ink-2">Liczenie…</p>;

  const { overview: ov } = data;
  const today = studyDay(new Date());
  const maxKind = Math.max(...data.kinds.map((k) => k.cards), 1);

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Statystyki</h1>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink-2 outline-none focus:border-accent"
        >
          {PERIODS.map((period) => (
            <option key={period.days} value={period.days}>
              {period.label}
            </option>
          ))}
        </select>
      </div>

      {/* Jedna liczba, ktora naprawde niesie decyzje. */}
      <section className="rounded-xl border border-line bg-surface p-[18px]">
        <p className="text-xs tracking-[0.01em] text-ink-3">SKUTECZNOŚĆ</p>
        <div className="mt-1.5 flex items-baseline gap-2.5">
          <span className="text-[40px] font-medium tabular-nums tracking-[-0.03em]">
            {percent(ov.retention)}
          </span>
          <span className="text-[13px] text-ink-3">
            {ov.retentionSample > 0
              ? `próba: ${ov.retentionSample}${
                  ov.retentionSample < MIN_REVIEWS_FOR_SIGNAL ? " (mało)" : ""
                }`
              : "brak kart nauczonych"}
          </span>
        </div>
        <div className="mt-3.5 flex gap-6 border-t border-line-soft pt-3.5">
          <div>
            <p className="text-xs text-ink-3">świeże</p>
            <p className="mt-0.5 text-[17px] tabular-nums">{percent(ov.retentionYoung)}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">utrwalone</p>
            <p className="mt-0.5 text-[17px] tabular-nums">{percent(ov.retentionMature)}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">passa</p>
            <p className="mt-0.5 text-[17px] tabular-nums">
              {ov.streakDays} {odmien(ov.streakDays, "dzień", "dni", "dni")}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-3">czas</p>
            <p className="mt-0.5 text-[17px] tabular-nums">{duration(ov.totalSeconds)}</p>
          </div>
        </div>
      </section>

      {/* Sedno: co idzie gorzej i dlaczego. */}
      <section>
        <p className="mb-2 text-xs tracking-[0.01em] text-ink-3">WEDŁUG RODZAJU MATERIAŁU</p>
        {data.kinds.length === 0 ? (
          <p className="text-sm text-ink-2">Brak materiału — dodaj albo zaimportuj fiszki.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {data.kinds.map((row, i) => (
              <div
                key={row.itemKind}
                className={`flex items-center gap-3 px-4 py-3.5 ${
                  i < data.kinds.length - 1 ? "border-b border-line-soft" : ""
                }`}
              >
                <span
                  className={`w-[88px] shrink-0 text-sm ${
                    row.retention === null ? "text-ink-3" : ""
                  }`}
                >
                  {ITEM_KIND_LABELS[row.itemKind]}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  {row.retention !== null && (
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${row.retention * 100}%` }}
                    />
                  )}
                </span>
                <span className="w-[46px] shrink-0 text-right text-sm tabular-nums">
                  {row.retention === null ? (
                    <span className="text-ink-4">—</span>
                  ) : (
                    `${Math.round(row.retention * 100)}%`
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
          Skuteczność pojawia się od {MIN_REVIEWS_FOR_SIGNAL} powtórek kart nauczonych —
          mniejsza próba to szum, nie sygnał.
        </p>
      </section>

      <section>
        <p className="mb-2 text-xs tracking-[0.01em] text-ink-3">POWTÓRKI DZIENNIE</p>
        {ov.daily.length === 0 ? (
          <p className="text-sm text-ink-2">W tym okresie nie było powtórek.</p>
        ) : (
          <Bars
            points={ov.daily.map((d) => ({
              day: d.day,
              count: d.reviews,
              highlight: d.day === today,
              title: `${shortDay(d.day)}: ${d.reviews} powtórek, ${duration(d.seconds)}`,
            }))}
          />
        )}
      </section>

      <section>
        <p className="mb-2 text-xs tracking-[0.01em] text-ink-3">
          PROGNOZA — NAJBLIŻSZE 14 DNI
        </p>
        {data.load.length === 0 ? (
          <p className="text-sm text-ink-2">Nic nie czeka w kolejce.</p>
        ) : (
          <>
            <Bars
              points={data.load.map((p) => ({
                day: p.day,
                count: p.count,
                highlight: p.day < today,
                title: `${shortDay(p.day)}: ${p.count} kart${p.day < today ? " (zaległe)" : ""}`,
              }))}
            />
            {data.load.some((p) => p.day < today) && (
              <p className="mt-2 text-[11px] text-ink-4">
                Wyróżnione słupki to zaległości z poprzednich dni.
              </p>
            )}
          </>
        )}
      </section>

      {ov.reviews > 0 && (
        <section>
          <p className="mb-2 text-xs tracking-[0.01em] text-ink-3">ROZKŁAD OCEN</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3.5 text-sm">
            {([1, 2, 3, 4] as Rating[]).map((rating) => (
              <span key={rating} className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${RATING_DOT[rating]}`}
                />
                <span className="text-ink-2">{RATING_LABELS[rating]}</span>
                <span className="tabular-nums">{ov.ratings[String(rating)] ?? 0}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {data.tags.length > 0 && (
        <section>
          <p className="mb-2 text-xs tracking-[0.01em] text-ink-3">TAGI</p>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {data.tags.map((row, i) => (
              <div
                key={row.tag}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${
                  i < data.tags.length - 1 ? "border-b border-line-soft" : ""
                }`}
              >
                <span className="min-w-0 truncate text-sm">{row.tag}</span>
                <span className="flex shrink-0 items-center gap-4 text-[13px] text-ink-2">
                  <span className="tabular-nums">{row.reviews} powt.</span>
                  <span className="w-11 text-right tabular-nums">
                    {percent(row.retention)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="mb-2 text-xs tracking-[0.01em] text-ink-3">DO PRZEFORMUŁOWANIA</p>
        {data.problems.length === 0 ? (
          <p className="text-sm text-ink-2">Nic się uporczywie nie myli. Tak trzymać.</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {data.problems.map((card, i) => (
                <div
                  key={card.cardId}
                  className={`px-4 py-3 ${
                    i < data.problems.length - 1 ? "border-b border-line-soft" : ""
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 flex-1">
                      <span className="tresc break-words text-[15px]">{card.front}</span>
                      <span className="text-sm text-ink-3"> → {card.back}</span>
                    </p>
                    <span className="shrink-0 text-xs tabular-nums text-ink-3">
                      {card.lapses}/{card.reps}
                      {card.isLeech && (
                        <span className="ml-1.5 font-medium text-again">pijawka</span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
              Dużo wpadek zwykle nie znaczy „powtarzaj więcej”, tylko „fiszka jest źle
              sformułowana” — za dużo naraz, myli się z inną, brak kontekstu.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Slupki dzienne: jedna seria, jeden odcien - tozsamosc niesie tytul sekcji,
 * nie kolor. Wyroznienie tylko dla dnia biezacego albo zaleglosci.
 */
function Bars({
  points,
}: {
  points: Array<{ day: string; count: number; highlight?: boolean; title: string }>;
}) {
  const max = Math.max(...points.map((p) => p.count), 1);
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 pb-3 pt-4">
      <div className="flex h-[62px] items-end gap-[3px]" role="img" aria-label="Wykres słupkowy">
        {points.map((point) => (
          <div key={point.day} title={point.title} className="flex h-full flex-1 items-end">
            <div
              className={`w-full rounded-t-[2px] ${point.highlight ? "bg-accent" : "bg-accent/30"}`}
              style={{
                height: `${Math.max((point.count / max) * 100, point.count > 0 ? 4 : 0)}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-ink-4">
        <span>{shortDay(points[0].day)}</span>
        {points.length > 1 && <span>{shortDay(points[points.length - 1].day)}</span>}
      </div>
    </div>
  );
}
