"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FSRS } from "ts-fsrs";

import { AppShell, ErrorBanner } from "@/components/AppShell";
import { makeScheduler, previewIntervals } from "@/lib/local/scheduler";
import { exampleOf, renderCard, templateLabel } from "@/lib/local/render";
import {
  getSettings,
  studyQueue,
  submitReview,
  type StudyQueueResult,
} from "@/lib/local/repo";
import { RATING_LABELS, type Rating } from "@/lib/types";

const RATINGS: Rating[] = [1, 2, 3, 4];

const RATING_STYLE: Record<Rating, string> = {
  1: "bg-rose-600 hover:bg-rose-500",
  2: "bg-amber-600 hover:bg-amber-500",
  3: "bg-emerald-600 hover:bg-emerald-500",
  4: "bg-sky-600 hover:bg-sky-500",
};

export default function StudyPage() {
  return (
    <AppShell>
      {/* useSearchParams wymaga granicy Suspense przy eksporcie statycznym -
          strona jest prerenderowana bez znajomosci adresu. */}
      <Suspense fallback={<p className="text-sm opacity-70">Wczytywanie…</p>}>
        <StudySession />
      </Suspense>
    </AppShell>
  );
}

function StudySession() {
  const deckId = useSearchParams().get("talia") ?? "";

  const [queue, setQueue] = useState<StudyQueueResult | null>(null);
  const [scheduler, setScheduler] = useState<FSRS | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  //  Czas odpowiedzi - wymagany w logu (ADR 0005), mierzony od pokazania karty.
  const shownAt = useRef<number>(Date.now());

  const loadQueue = useCallback(async () => {
    if (!deckId) {
      setError("Brak talii w adresie");
      return;
    }
    try {
      const [settings, data] = await Promise.all([
        getSettings(),
        studyQueue(deckId, { limit: 20 }),
      ]);
      setScheduler(makeScheduler(settings));
      setQueue(data);
      setIndex(0);
      setRevealed(false);
      shownAt.current = Date.now();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie pobrac kolejki");
    }
  }, [deckId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const entry = queue?.cards[index] ?? null;

  // Podglad liczony dla biezacej karty - etykiety na przyciskach dotycza
  // dokladnie tego momentu.
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
        setError(caught instanceof Error ? caught.message : "Nie udalo sie zapisac oceny");
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
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <Link href="/" className="text-sm underline opacity-70 hover:opacity-100">
          ← Wroc do talii
        </Link>
      </div>
    );
  }

  if (queue === null) {
    return <p className="text-sm opacity-70">Wczytywanie…</p>;
  }

  if (!entry) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Na dzis gotowe</h1>
        <p className="text-sm opacity-70">
          {reviewedCount > 0
            ? `Powtorzono kart: ${reviewedCount}. Kolejne karty pojawia sie zgodnie z harmonogramem FSRS.`
            : "W tej talii nie ma teraz nic do powtorzenia."}
        </p>
        <ErrorBanner message={error} />
        <div className="flex gap-2">
          <Link
            href="/"
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Wroc do talii
          </Link>
          <Link
            href={`/fiszki?talia=${deckId}`}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Dodaj fiszki
          </Link>
        </div>
      </div>
    );
  }

  const { question, answer } = renderCard(entry.note, entry.card.templateOrd);
  const example = exampleOf(entry.note);
  const isNewCard = entry.card.fsrs.state === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-sm opacity-70">
        <Link href="/" className="underline hover:opacity-100">
          ← Talie
        </Link>
        <span>
          <span className="text-blue-600 dark:text-blue-400">
            {queue.newRemaining} nowych
          </span>
          {" · "}
          <span className="text-emerald-600 dark:text-emerald-400">
            {queue.dueRemaining} do powtorki
          </span>
        </span>
      </div>

      <article className="rounded-xl border border-black/10 p-6 dark:border-white/15">
        <p className="text-xs uppercase tracking-wide opacity-50">
          {templateLabel(entry.card.templateOrd)}
          {isNewCard && " · nowa"}
        </p>
        <p className="mt-4 whitespace-pre-wrap text-xl">{question}</p>

        {revealed && (
          <>
            <hr className="my-5 border-black/10 dark:border-white/15" />
            <p className="whitespace-pre-wrap text-xl">{answer}</p>
            {example && (
              <p className="mt-3 whitespace-pre-wrap border-l-2 border-indigo-500/40 pl-3 text-base italic opacity-75">
                {example}
              </p>
            )}
          </>
        )}

        {entry.note.tags.length > 0 && (
          <p className="mt-4 flex flex-wrap gap-1.5">
            {entry.note.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-black/5 px-2 py-0.5 text-xs opacity-70 dark:bg-white/10"
              >
                {tag}
              </span>
            ))}
          </p>
        )}
      </article>

      <ErrorBanner message={error} />

      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="w-full rounded-md bg-indigo-600 px-3 py-3 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Pokaz odpowiedz <span className="opacity-60">(spacja)</span>
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RATINGS.map((rating) => (
            <button
              key={rating}
              type="button"
              disabled={busy}
              onClick={() => void rate(rating)}
              className={`rounded-md px-3 py-3 text-sm font-medium text-white disabled:opacity-50 ${RATING_STYLE[rating]}`}
            >
              <span className="block">
                {rating}. {RATING_LABELS[rating]}
              </span>
              <span className="block text-xs font-normal opacity-80">
                {preview?.[rating] ?? "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
