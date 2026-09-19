"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FSRS } from "ts-fsrs";

import { ErrorBanner, FocusShell, buttonClass, inputClass, secondaryButtonClass } from "@/components/AppShell";
import { compareAnswer } from "@/lib/local/answer";
import { splitCzlony } from "@/lib/local/content";
import { firstClozeLine, splitOnPhrase } from "@/lib/local/phrase";
import { makeScheduler, previewIntervals } from "@/lib/local/scheduler";
import {
  cueOf,
  exampleOf,
  formalOf,
  pronunciationOf,
  renderCard,
  templateLabel,
} from "@/lib/local/render";
import {
  getSettings,
  setNoteSuspended,
  studyQueue,
  submitReview,
  undoLastReview,
  type DeckSelection,
  type StudyQueueResult,
} from "@/lib/local/repo";
import {
  RECOGNITION_ERROR_LABELS,
  listenOnce,
  recognitionAvailable,
  type ListenHandle,
} from "@/lib/listen";
import { DEFAULT_PREFS, loadPrefs, type StudyPrefs } from "@/lib/prefs";
import { speak, speechAvailable, stopSpeaking } from "@/lib/speech";
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
  const params = useSearchParams();
  const param = params.get("talia") ?? "";
  //: Krotka sesja "w kolejce do gabinetu" - inny limit, ta sama kolejka.
  const limit = Number(params.get("ile")) || 20;
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
  // Ile kart mialo byc na starcie sesji - do paska postepu. Stan, nie ref:
  // wartosc jest czytana w renderze.
  const [sessionSize, setSessionSize] = useState(0);
  const [prefs, setPrefs] = useState<StudyPrefs>(DEFAULT_PREFS);
  //: Czy ostatnia ocene da sie jeszcze cofnac (tylko w obrebie tej sesji).
  const [canUndo, setCanUndo] = useState(false);
  const [typed, setTyped] = useState("");
  //: Dostepnosc mowy sprawdzamy po stronie przegladarki - w renderze na
  //: serwerze nie ma window, a rozbiezny wynik rozjechalby hydracje.
  const [canSpeak, setCanSpeak] = useState(false);
  const [canListen, setCanListen] = useState(false);
  //: Ten sam uchwyt co `nasluch`, widoczny w efekcie sprzatajacym, ktory
  //: stoi wyzej w pliku niz deklaracja tamtego.
  const nasluchNaWyjsciu = useRef<ListenHandle | null>(null);
  const [sluchanie, setSluchanie] = useState(false);
  //: Tryb sluchania: karty ida same, czytane na glos, BEZ oceniania.
  //: To przeglad w drodze, nie sesja - stan powtorek zostaje nietkniety.
  const [trybSluchania, setTrybSluchania] = useState(false);

  //  Czas odpowiedzi - wymagany w logu (ADR 0005), mierzony od pokazania karty.
  // Ustawiane przy pokazaniu karty (loadQueue/rate), nie w renderze.
  const shownAt = useRef<number>(0);
  //: Zegary trybu sluchania - do posprzatania przy wyjsciu.
  const zegary = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Obie wartosci istnieja wylacznie w przegladarce (localStorage, window).
    // W renderze nie wolno ich czytac, bo eksport statyczny renderuje strone
    // takze bez okna - stad zapis w efekcie.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(loadPrefs());
    setCanSpeak(speechAvailable());
    setCanListen(recognitionAvailable());
    // Wyjscie z ekranu ucina wypowiedz i nasluch - inaczej telefon mowi do
    // pustego pokoju albo trzyma wlaczony mikrofon.
    return () => {
      stopSpeaking();
      nasluchNaWyjsciu.current?.stop();
    };
  }, []);

  const loadQueue = useCallback(async () => {
    if (!param) {
      setError("Brak talii w adresie");
      return;
    }
    try {
      const [settings, data] = await Promise.all([
        getSettings(),
        studyQueue(selection, { limit }),
      ]);
      setScheduler(makeScheduler(settings));
      setQueue(data);
      setSessionSize((size) => (size === 0 ? data.cards.length : size));
      setIndex(0);
      setRevealed(false);
      setTyped("");
      shownAt.current = Date.now();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się pobrać kolejki");
    }
    // selection powstaje z param przy kazdym renderze - zalezymy od param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param, limit]);

  useEffect(() => {
    // Stan pochodzi z IndexedDB, wiec zapis nastepuje po await, nie w ciele
    // efektu; regula tego nie rozroznia.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadQueue();
  }, [loadQueue]);

  const entry = queue?.cards[index] ?? null;

  const preview = useMemo(() => {
    if (!entry || !scheduler) return null;
    return previewIntervals(scheduler, entry.card.fsrs, new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.card.id, scheduler]);

  //: Angielska strona fiszki - niezaleznie od kierunku karty czytamy to samo.
  const englishText = entry?.note.fields.Front ?? "";
  //: Przy produkcji (polski -> angielski) zdanie z luka daje kontekst, ale nie
  //: zdradza odpowiedzi - sam zwrot jest z niego wyciety.
  //: Karty, w ktorych odpowiedzia jest angielski termin: produkcja z polskiego
  //: (ord 1) i rozpoznanie z opisu (ord 2). Luka i wpisywanie maja sens
  //: w obu - przy karcie opisowej zdanie z wycietym terminem plus synonim to
  //: dokladnie zadanie z czesci Reading.
  const odpowiedzPoAngielsku = entry !== null && entry.card.templateOrd !== 0;
  const cloze = useMemo(() => {
    if (!entry || entry.card.templateOrd === 0 || !prefs.showCloze) return null;
    const example = exampleOf(entry.note);
    return example ? firstClozeLine(example, englishText) : null;
  }, [entry, prefs.showCloze, englishText]);

  //: Wpisywanie odpowiedzi ma sens tylko tam, gdzie cwiczy sie produkcje -
  //: i tylko gdy odpowiedz jest jednym zwrotem, nie akapitem.
  const wantsTyping = prefs.typeAnswer && odpowiedzPoAngielsku && englishText.length <= 60;

  //: Uchwyt nasluchu - przerywamy go przy zmianie karty i wyjsciu z ekranu.
  const nasluch = useRef<ListenHandle | null>(null);
  const przerwijNasluch = useCallback(() => {
    nasluch.current?.stop();
    nasluch.current = null;
    nasluchNaWyjsciu.current = null;
    setSluchanie(false);
  }, []);

  function powiedz() {
    if (sluchanie) {
      przerwijNasluch();
      return;
    }
    setError(null);
    const uchwyt = listenOnce({
      onResult: (transcript) => setTyped(transcript),
      onError: (kod) => setError(RECOGNITION_ERROR_LABELS[kod]),
      onEnd: () => {
        nasluch.current = null;
        setSluchanie(false);
      },
    });
    if (!uchwyt) {
      setError("Ta przeglądarka nie rozpoznaje mowy.");
      return;
    }
    nasluch.current = uchwyt;
    nasluchNaWyjsciu.current = uchwyt;
    setSluchanie(true);
  }

  const reveal = useCallback(() => {
    setRevealed(true);
    if (prefs.autoSpeak) speak(englishText);
  }, [prefs.autoSpeak, englishText]);

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
        setCanUndo(true);

        const next = index + 1;
        if (queue && next < queue.cards.length) {
          setIndex(next);
          setRevealed(false);
          setTyped("");
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

  async function undo() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const cofniete = await undoLastReview();
      if (!cofniete) {
        setCanUndo(false);
        return;
      }
      setReviewedCount((n) => Math.max(0, n - 1));
      setCanUndo(false);
      await loadQueue();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się cofnąć oceny");
    } finally {
      setBusy(false);
    }
  }

  async function suspend() {
    if (!entry || busy) return;
    if (!confirm(`Odłożyć „${entry.note.fields.Front}” na bok? Wróci dopiero, gdy ją przywrócisz.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setNoteSuspended(entry.note.id, true);
      await loadQueue();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się odłożyć fiszki");
    } finally {
      setBusy(false);
    }
  }

  // Tryb sluchania: przod -> pauza -> tyl -> pauza -> nastepna karta.
  // Nie zapisuje ocen i nie rusza FSRS; wychodzi sie jednym dotknieciem.
  useEffect(() => {
    if (!trybSluchania || !entry) return;
    let porzucone = false;
    const czekaj = (ms: number) =>
      new Promise((res) => {
        const id = setTimeout(res, ms);
        zegary.current.push(id);
      });

    void (async () => {
      setRevealed(false);
      speak(englishText);
      // Tyle, ile trwa przypomnienie sobie odpowiedzi - dluzej niz odczyt.
      await czekaj(3200);
      if (porzucone) return;
      setRevealed(true);
      await czekaj(2600);
      if (porzucone) return;
      // Kolejna karta albo koniec: kolejki nie dociagamy, bo nic nie ocenilismy
      // i dostalibysmy w kolko te sama.
      if (queue && index + 1 < queue.cards.length) setIndex(index + 1);
      else setTrybSluchania(false);
    })();

    return () => {
      porzucone = true;
      for (const id of zegary.current) clearTimeout(id);
      zegary.current = [];
      stopSpeaking();
    };
  }, [trybSluchania, entry, englishText, index, queue]);

  // Skroty klawiszowe: spacja odslania, 1-4 ocenia.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!entry) return;
      // Przytrzymany klawisz to jeden zamiar, nie seria ocen.
      if (event.repeat) return;
      // Spacja i Enter na przycisku albo linku maja robic to, co przycisk -
      // inaczej Enter na "Znowu" zapisywalby "Dobre", a strzalka wstecz
      // odslanialaby odpowiedz zamiast wracac. Wyjatek: pole odpowiedzi,
      // gdzie Enter ma odslaniac.
      const target = event.target;
      if (target instanceof HTMLElement) {
        const control = target.closest("button, a, select, textarea, input");
        if (control && control.getAttribute("data-odpowiedz") === null) return;
      }
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        if (!revealed) reveal();
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
  }, [entry, revealed, rate, reveal]);

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
              : singleDeckId
                ? "W tej talii nie ma teraz nic do powtórzenia."
                : "W wybranych taliach nie ma teraz nic do powtórzenia."}
          </p>
        </div>
        <ErrorBanner message={error} />
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/" className={secondaryButtonClass}>
            Wróć do talii
          </Link>
          {canUndo && (
            <button type="button" onClick={() => void undo()} className={secondaryButtonClass}>
              Cofnij ostatnią ocenę
            </button>
          )}
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
  const total = Math.max(sessionSize, reviewedCount + queue.cards.length - index);
  const done = Math.min(reviewedCount, total);
  const ocena = wantsTyping && revealed ? compareAnswer(typed, englishText) : null;

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

      {trybSluchania && (
        <p className="mx-5 mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-center text-[12px] text-ink-2">
          Tryb słuchania — karty idą same i nie są oceniane. Stan powtórek bez zmian.
        </p>
      )}

      {/* Srodek ekranu nalezy do fiszki. */}
      <div className="flex flex-1 flex-col justify-center px-7 py-6 text-center">
        <p className="mb-5 text-[11px] uppercase tracking-[0.08em] text-ink-4">
          {entry.deckName && !singleDeckId ? `${entry.deckName} · ` : ""}
          {templateLabel(entry.card.templateOrd)}
          {isNewCard && " · nowa"}
        </p>

        {!revealed ? (
          <>
            {/* Wskazowka karty opisowej bywa dluga (do 86 znakow w pakiecie),
                wiec mniejszy stopien i lamanie dlugich ciagow. */}
            <p
              className={`tresc whitespace-pre-wrap tracking-[-0.01em] ${
                entry.card.templateOrd === 2
                  ? "break-words text-[26px] leading-[1.32]"
                  : "text-[34px] leading-[1.25]"
              }`}
            >
              {question}
            </p>
            {/* Kontekst bez podpowiedzi: sam zwrot jest ze zdania wyciety. */}
            {cloze && (
              <p className="tresc mx-auto mt-5 max-w-md whitespace-pre-wrap border-l-2 border-line pl-3.5 text-left text-[15px] italic leading-[1.55] text-ink-3">
                {cloze}
              </p>
            )}
            {wantsTyping && (
              <div className="mx-auto mt-6 flex w-full max-w-md items-center gap-2">
                <input
                  data-odpowiedz=""
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      reveal();
                    }
                  }}
                  placeholder="Wpisz po angielsku…"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className={`${inputClass} flex-1 text-center text-lg`}
                />
                {canListen && (
                  <button
                    type="button"
                    onClick={powiedz}
                    aria-label={sluchanie ? "Przerwij nagrywanie" : "Powiedz odpowiedź"}
                    aria-pressed={sluchanie}
                    className={`shrink-0 rounded-lg border p-2.5 ${
                      sluchanie
                        ? "animate-pulse border-again-line bg-again-bg text-again"
                        : "border-line text-ink-3 hover:border-field hover:text-ink"
                    }`}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="tresc whitespace-pre-wrap text-[26px] leading-[1.3] text-ink-2">
              {question}
            </p>
            <div className="mx-auto my-5 h-px w-9 bg-field" />

            {/* Co naprawde wpisano - litera po literze, zanim padnie ocena. */}
            {ocena && (
              <p className="mb-3 text-[19px] tracking-[-0.01em]">
                {typed.trim() === "" ? (
                  <span className="text-ink-4">(brak odpowiedzi)</span>
                ) : (
                  ocena.parts.map((part, i) => (
                    <span
                      key={i}
                      className={part.ok ? "text-good" : "text-again line-through decoration-1"}
                    >
                      {part.text}
                    </span>
                  ))
                )}
              </p>
            )}

            <div className="flex items-center justify-center gap-2.5">
              <p className="tresc whitespace-pre-wrap text-[30px] leading-[1.28] tracking-[-0.01em]">
                {answer}
              </p>
              {/* Przy karcie opisowej glosnik czyta Front, czyli ODPOWIEDZ -
                  dlatego pokazuje sie dopiero tutaj, po odslonieciu. */}
              {canSpeak && (
                <button
                  type="button"
                  onClick={() => speak(englishText)}
                  aria-label="Przeczytaj na głos"
                  className="shrink-0 text-ink-3 hover:text-accent"
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
                  </svg>
                </button>
              )}
            </div>

            {ocena && !ocena.exact && ocena.close && (
              <p className="mt-2 text-[13px] text-hard">Prawie — różnica w pisowni.</p>
            )}

            <Adnotacje
              wymowa={pronunciationOf(entry.note)}
              synonimy={entry.card.templateOrd === 2 ? "" : cueOf(entry.note)}
              formalnie={formalOf(entry.note)}
              polski={entry.card.templateOrd === 2 ? entry.note.fields.Back : ""}
            />

            {example && (
              <p className="tresc mt-5 whitespace-pre-wrap border-l-2 border-line pl-3.5 text-left text-[15px] italic leading-[1.55] text-ink-2">
                {/* Zwrot wyrozniony - widac, jak siedzi w zdaniu. */}
                {example.split("\n").map((linia, i) => (
                  <span key={i}>
                    {i > 0 && "\n"}
                    {splitOnPhrase(linia, englishText).map((frag, j) =>
                      frag.zwrot ? (
                        <strong key={j} className="font-semibold not-italic text-ink">
                          {frag.tekst}
                        </strong>
                      ) : (
                        <span key={j}>{frag.tekst}</span>
                      ),
                    )}
                  </span>
                ))}
              </p>
            )}
            {entry.note.tags.length > 0 && (
              <p className="mt-5 flex flex-wrap justify-center gap-1.5">
                {entry.note.tags.map((tag) => (
                  <span key={tag} className="rounded bg-chip px-2 py-1 text-[11px] text-ink-3">
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
        {trybSluchania ? (
          <button
            type="button"
            onClick={() => setTrybSluchania(false)}
            className="mt-2 w-full rounded-[10px] border border-line px-3 py-4 text-base font-medium hover:border-field"
          >
            Zatrzymaj i wróć do oceniania
          </button>
        ) : !revealed ? (
          <button
            type="button"
            onClick={reveal}
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

        {/* Rzadkie akcje - male, na uboczu, zeby nie konkurowaly z ocenami. */}
        <div className="mt-3 flex items-center justify-center gap-4 text-[12px] text-ink-4">
          <button
            type="button"
            disabled={!canUndo || busy}
            onClick={() => void undo()}
            className="hover:text-ink-2 disabled:opacity-40"
          >
            ↶ Cofnij ocenę
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void suspend()}
            className="hover:text-ink-2 disabled:opacity-40"
          >
            Odłóż na bok
          </button>
          {canSpeak && (
            <button
              type="button"
              onClick={() => setTrybSluchania((tak) => !tak)}
              aria-pressed={trybSluchania}
              className={trybSluchania ? "font-medium text-accent" : "hover:text-ink-2"}
            >
              {trybSluchania ? "■ Zatrzymaj słuchanie" : "▸ Słuchaj"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Wymowa, synonimy i odpowiednik formalny pod odpowiedzia.
 *
 * Bez ramki i bez koloru: kolor w tej aplikacji niesie znaczenie wylacznie
 * przy ocenach. Etykiety mikroskopijne, tresc czytelna - to material
 * pomocniczy, nie druga fiszka.
 */
function Adnotacje({
  wymowa,
  synonimy,
  formalnie,
  polski,
}: {
  wymowa: string;
  synonimy: string;
  formalnie: string;
  polski: string;
}) {
  if (!wymowa && !synonimy && !formalnie && !polski) return null;
  const etykieta = "text-[11px] uppercase tracking-[0.08em] text-ink-4";

  return (
    <div className="mx-auto mt-5 w-full max-w-md space-y-2.5 text-left">
      {polski && <p className="text-[15px] text-ink-2">{polski}</p>}
      {wymowa && (
        <p className="text-[14px] text-ink-2">
          <span className={etykieta}>wymowa</span>{" "}
          <span className="tabular-nums">{wymowa}</span>
        </p>
      )}
      {synonimy && (
        <p className="text-[14px] text-ink-2">
          <span className={etykieta}>to samo co</span> {splitCzlony(synonimy).join(" · ")}
        </p>
      )}
      {formalnie && (
        <p className="text-[14px] text-ink-2">
          <span className={etykieta}>formalnie</span> {splitCzlony(formalnie).join(" · ")}
        </p>
      )}
    </div>
  );
}
