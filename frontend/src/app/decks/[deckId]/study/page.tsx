"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell, ErrorBanner } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { RATING_LABELS, type Rating, type ReviewResult, type StudyQueue } from "@/lib/types";

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
      <StudySession />
    </AppShell>
  );
}

function StudySession() {
  const { user } = useAuth();
  const params = useParams<{ deckId: string }>();
  const deckId = params.deckId;

  const [queue, setQueue] = useState<StudyQueue | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  //  Do pomiaru, ile czasu zajela odpowiedz - FSRS moze to pozniej wykorzystac
  //  przy optymalizacji parametrow.
  const shownAt = useRef<number>(Date.now());

  const loadQueue = useCallback(async () => {
    try {
      const data = await api<StudyQueue>(`/study/queue?deck_id=${deckId}&limit=20`);
      setQueue(data);
      setIndex(0);
      setRevealed(false);
      shownAt.current = Date.now();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie pobrac kolejki");
    }
  }, [deckId]);

  useEffect(() => {
    if (user) void loadQueue();
  }, [user, loadQueue]);

  const card = queue?.cards[index] ?? null;

  const rate = useCallback(
    async (rating: Rating) => {
      if (!card || busy) return;
      setBusy(true);
      setError(null);
      try {
        await api<ReviewResult>("/study/review", {
          method: "POST",
          body: {
            card_id: card.card_id,
            rating,
            // UUID generowany po stronie klienta: ponowienie po zerwaniu sieci
            // nie zapisze tej samej powtorki dwa razy.
            client_event_id: crypto.randomUUID(),
            duration_ms: Date.now() - shownAt.current,
          },
        });
        setReviewedCount((n) => n + 1);

        const next = index + 1;
        if (queue && next < queue.cards.length) {
          setIndex(next);
          setRevealed(false);
          shownAt.current = Date.now();
        } else {
          // Karty w trakcie nauki wracaja po kilku minutach - dociagamy kolejke
          // zamiast konczyc sesje przedwczesnie.
          await loadQueue();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Nie udalo sie zapisac oceny");
      } finally {
        setBusy(false);
      }
    },
    [card, busy, index, queue, loadQueue],
  );

  // Skroty klawiszowe: spacja odslania, 1-4 ocenia. Na desktopie to roznica
  // miedzy sesja na 5 minut a sesja na 15.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!card) return;
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
  }, [card, revealed, rate]);

  if (queue === null) {
    return <p className="text-sm opacity-70">Wczytywanie…</p>;
  }

  if (!card) {
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
            href={`/decks/${deckId}/notes`}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Dodaj fiszki
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-sm opacity-70">
        <Link href="/" className="underline hover:opacity-100">
          ← Talie
        </Link>
        <span>
          <span className="text-blue-600 dark:text-blue-400">{queue.new_remaining} nowych</span>
          {" · "}
          <span className="text-emerald-600 dark:text-emerald-400">
            {queue.due_remaining} do powtorki
          </span>
        </span>
      </div>

      <article className="rounded-xl border border-black/10 p-6 dark:border-white/15">
        <p className="text-xs uppercase tracking-wide opacity-50">
          {card.template_label}
          {card.is_new && " · nowa"}
        </p>
        <p className="mt-4 whitespace-pre-wrap text-xl">{card.question}</p>

        {revealed && (
          <>
            <hr className="my-5 border-black/10 dark:border-white/15" />
            <p className="whitespace-pre-wrap text-xl">{card.answer}</p>
            {card.example && (
              <p className="mt-3 whitespace-pre-wrap border-l-2 border-indigo-500/40 pl-3 text-base italic opacity-75">
                {card.example}
              </p>
            )}
          </>
        )}

        {card.tags.length > 0 && (
          <p className="mt-4 flex flex-wrap gap-1.5">
            {card.tags.map((tag) => (
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
                {card.interval_preview[String(rating)] ?? "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
