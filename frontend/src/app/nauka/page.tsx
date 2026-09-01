"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FSRS } from "ts-fsrs";

import { ErrorBanner, FocusShell, buttonClass, secondaryButtonClass } from "@/components/AppShell";
import { makeScheduler, previewIntervals } from "@/lib/local/scheduler";
import { exampleOf, renderCard, templateLabel } from "@/lib/local/render";
import {
  getSettings,
  studyQueue,
  submitReview,
  type DeckSelection,
  type StudyQueueResult,
} from "@/lib/local/repo";
import { RATING_LABELS, type Rating } from "@/lib/types";

const RATINGS: Rating[] = [1, 2, 3, 4];

/** Kolor niesie znaczenie tylko tutaj - i nigdy sam, zawsze z etykieta. */
const RATING_STYLE: Record<Rating, string> = {
  1: "border-again-line bg-again-bg text-again",
  2: "border-hard-line bg-hard-bg text-hard",
  3: "border-good-line bg-good-bg text-good",
  4: "border-easy-line bg-easy-bg text-easy",
};

export default function StudyPage() {
  return (
    <FocusShell>
      {/* Granica Suspense - useSearchParams przy eksporcie statycznym. */}
      <Suspense fallback={<p className="p-5 text-sm text-ink-2">Wczytywanie…</p>}>
        <StudySession />
      </Suspense>
    </FocusShell>
  );
}

function StudySession() {
  const param = useSearchParams().get("talia") ?? "";
  // "wszystko" = cala kolekcja, lista po przecinku = wybrane talie.
  const selection: DeckSelection =
    param === "wszystko" ? "all" : param.includes(",") ? param.split(",") : param;
  // Dokad wracac po "Dodaj fiszki" - tylko przy jednej talii ma to sens.
  const singleDeckId = param.includes(",") || param === "wszystko" ? null : param;

  const [queue, setQueue] = useState<StudyQueueResult | null>(null);
  const [scheduler, setScheduler] = useState<FSRS | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  // Ile kart mialo byc na starcie sesji - do paska postepu.
  const sessionSize = useRef(0);

  //  Czas odpowiedzi - wymagany w logu (ADR 0005), mierzony od pokazania karty.
  const shownAt = useRef<number>(Date.now());

  const loadQueue = useCallback(async () => {
    if (!param) {
      setError("Brak talii w adresie");
      return;
    }
    try {
      const [settings, data] = await Promise.all([
        getSettings(),
        studyQueue(selection, { limit: 20 }),
      ]);
      setScheduler(makeScheduler(settings));
      setQueue(data);
      if (sessionSize.current === 0) sessionSize.current = data.cards.length;
      setIndex(0);
      setRevealed(false);
      shownAt.current = Date.now();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się pobrać kolejki");
    }
    // selection powstaje z param przy kazdym renderze - zalezymy od param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const entry = queue?.cards[index] ?? null;

  const preview = useMemo(() => {
    if (!entry || !scheduler) return null;
    return previewIntervals(scheduler, entry.card.fsrs, new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.card.id, scheduler]);

  const rate = useCallback(
    async (rating: Rating) => {
      if (!entry || busy) return;
      setBusy(true);
      setError(null);
      try {
        await submitReview({
          cardId: entry.card.id,
          rating,
          durationMs: Date.now() - shownAt.current,
        });
        setReviewedCount((n) => n + 1);

        const next = index + 1;
        if (queue && next < queue.cards.length) {
          setIndex(next);
          setRevealed(false);
          shownAt.current = Date.now();
        } else {
          // Karty w trakcie nauki wracaja po kilku minutach - dociagamy
          // kolejke zamiast konczyc sesje przedwczesnie.
          await loadQueue();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Nie udało się zapisać oceny");
      } finally {
        setBusy(false);
      }
    },
    [entry, busy, index, queue, loadQueue],
  );

  // Skroty klawiszowe: spacja odslania, 1-4 ocenia.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!entry) return;
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        else void rate(3);
        return;
      }
      if (revealed && ["Digit1", "Digit2", "Digit3", "Digit4"].includes(event.code)) {
        event.preventDefault();
        void rate(Number(event.code.slice(-1)) as Rating);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, revealed, rate]);

  if (error && !queue) {
    return (
      <div className="space-y-4 p-5">
        <ErrorBanner message={error} />
        <Link href="/" className="text-sm text-accent">
          ← Wróć do talii
        </Link>
      </div>
    );
  }

  if (queue === null) {
    return <p className="p-5 text-sm text-ink-2">Wczytywanie…</p>;
  }

  if (!entry) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Na dziś gotowe</h1>
          <p className="mt-2 text-sm text-ink-2">
            {reviewedCount > 0
              ? `Powtórzono kart: ${reviewedCount}. Kolejne pojawią się zgodnie z harmonogramem.`
              : "W tej talii nie ma teraz nic do powtórzenia."}
          </p>
        </div>
        <ErrorBanner message={error} />
        <div className="flex gap-2">
          <Link href="/" className={secondaryButtonClass}>
            Wróć do talii
          </Link>
          {singleDeckId && (
            <Link href={`/fiszki?talia=${singleDeckId}`} className={buttonClass}>
              Dodaj fiszki
            </Link>
          )}
        </div>
      </div>
    );
  }

  const { question, answer } = renderCard(entry.note, entry.card.templateOrd);
  const example = exampleOf(entry.note);
  const isNewCard = entry.card.fsrs.state === 0;
  const total = Math.max(sessionSize.current, reviewedCount + queue.cards.length - index);
  const done = Math.min(reviewedCount, total);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      {/* Pasek postepu zamiast licznikow - mniej cyfr do przetworzenia. */}
      <div className="flex items-center gap-3.5 px-5 pt-4">
        <Link href="/" aria-label="Wróć do talii" className="text-ink-3 hover:text-ink-2">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
          />
        </div>
        <span className="text-[13px] tabular-nums text-ink-3">
          {done} / {total}
        </span>
      </div>

      {/* Srodek ekranu nalezy do fiszki. */}
      <div className="flex flex-1 flex-col justify-center px-7 py-6 text-center">
        <p className="mb-5 text-[11px] uppercase tracking-[0.08em] text-ink-4">
          {entry.deckName && !singleDeckId ? `${entry.deckName} · ` : ""}
          {templateLabel(entry.card.templateOrd)}
          {isNewCard && " · nowa"}
        </p>

        {!revealed ? (
          <p className="tresc whitespace-pre-wrap text-[34px] leading-[1.25] tracking-[-0.01em]">
            {question}
          </p>
        ) : (
          <>
            <p className="tresc whitespace-pre-wrap text-[26px] leading-[1.3] text-ink-2">
              {question}
            </p>
            <div className="mx-auto my-5 h-px w-9 bg-field" />
            <p className="tresc whitespace-pre-wrap text-[30px] leading-[1.28] tracking-[-0.01em]">
              {answer}
            </p>
            {example && (
              <p className="tresc mt-5 whitespace-pre-wrap border-l-2 border-line pl-3.5 text-left text-[15px] italic leading-[1.55] text-ink-2">
                {example}
              </p>
            )}
            {entry.note.tags.length > 0 && (
              <p className="mt-5 flex flex-wrap justify-center gap-1.5">
                {entry.note.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-chip px-2 py-1 text-[11px] text-ink-3"
                  >
                    {tag}
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </div>

      <div className="px-5 pb-8">
        <ErrorBanner message={error} />
        {!revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-2 w-full rounded-[10px] bg-accent px-3 py-4 text-base font-medium text-on-accent hover:bg-accent-hover"
          >
            Pokaż odpowiedź
          </button>
        ) : (
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {RATINGS.map((rating) => (
              <button
                key={rating}
                type="button"
                disabled={busy}
                onClick={() => void rate(rating)}
                className={`rounded-[10px] border px-1 py-3 disabled:opacity-40 ${RATING_STYLE[rating]}`}
              >
                <span className="block text-sm font-medium">{RATING_LABELS[rating]}</span>
                <span className="mt-0.5 block text-[11px] tabular-nums opacity-70">
                  {preview?.[rating] ?? "—"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
