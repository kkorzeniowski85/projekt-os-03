/**
 * Rozpoznawanie mowy - powiedz zwrot zamiast go wpisywac.
 *
 * Po co: OET ma czesc ustna, a wymowa terminu ("haemoptysis", "pyrexia")
 * to osobna umiejetnosc od jego rozpoznania na kartce. Aplikacja nie ocenia
 * wymowy - pokazuje, co uslyszala, i to uzytkownik decyduje, czy trafil.
 * Sam przepis na ocene brzmienia wymagalby modelu akustycznego, ktorego tu
 * nie ma; rozbieznosc miedzy zamiarem a transkrypcja i tak jest sygnalem.
 *
 * WYMAGA SIECI. Chrome wysyla nagranie do uslugi rozpoznawania, wiec offline
 * to nie zadziala - stad osobny modul od speech.ts (synteza dziala offline)
 * i wyrazne rozroznienie w interfejsie.
 */

//: Typ wlasny - lib.dom.d.ts nie opisuje tego API (jest niestandaryzowane).
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function konstruktor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const okno = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return okno.SpeechRecognition ?? okno.webkitSpeechRecognition ?? null;
}

export function recognitionAvailable(): boolean {
  return konstruktor() !== null;
}

export type RecognitionError = "brak-zgody" | "brak-mowy" | "brak-sieci" | "inny";

function nazwijBlad(kod: string): RecognitionError {
  if (kod === "not-allowed" || kod === "service-not-allowed") return "brak-zgody";
  if (kod === "no-speech") return "brak-mowy";
  if (kod === "network") return "brak-sieci";
  return "inny";
}

export const RECOGNITION_ERROR_LABELS: Record<RecognitionError, string> = {
  "brak-zgody": "Brak zgody na mikrofon — udziel jej w ustawieniach przeglądarki.",
  "brak-mowy": "Nic nie usłyszałem. Spróbuj jeszcze raz.",
  "brak-sieci": "Rozpoznawanie mowy wymaga połączenia z siecią.",
  inny: "Nie udało się rozpoznać mowy.",
};

export interface ListenHandle {
  /** Przerywa nasluch; nie wywoluje juz zadnego z podanych wywolan zwrotnych. */
  stop(): void;
}

/**
 * Sluchа jednej wypowiedzi po angielsku.
 *
 * Zwraca uchwyt do przerwania albo null, gdy przegladarka tego nie potrafi.
 * `onResult` dostaje surowa transkrypcje - porownanie z wzorcem nalezy do
 * wolajacego (compareAnswer w local/answer.ts).
 */
export function listenOnce(handlers: {
  onResult: (transcript: string) => void;
  onError: (error: RecognitionError) => void;
  onEnd: () => void;
}): ListenHandle | null {
  const Ctor = konstruktor();
  if (!Ctor) return null;

  let porzucone = false;
  let rozpoznawanie: RecognitionLike;
  try {
    rozpoznawanie = new Ctor();
  } catch {
    return null;
  }

  rozpoznawanie.lang = "en-GB";
  rozpoznawanie.continuous = false;
  rozpoznawanie.interimResults = false;
  rozpoznawanie.maxAlternatives = 1;

  rozpoznawanie.onresult = (event) => {
    if (porzucone) return;
    const pierwszy = event.results?.[0]?.[0]?.transcript;
    if (pierwszy) handlers.onResult(pierwszy.trim());
  };
  rozpoznawanie.onerror = (event) => {
    if (porzucone) return;
    handlers.onError(nazwijBlad(event.error));
  };
  rozpoznawanie.onend = () => {
    if (!porzucone) handlers.onEnd();
  };

  try {
    rozpoznawanie.start();
  } catch {
    // Podwojne uruchomienie albo brak urzadzenia - traktujemy jak brak API.
    return null;
  }

  return {
    stop() {
      porzucone = true;
      try {
        rozpoznawanie.abort();
      } catch {
        // juz zakonczone
      }
    },
  };
}
