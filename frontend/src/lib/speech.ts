/**
 * Wymowa przez Web Speech API - bez serwera i bez plikow dzwiekowych.
 *
 * Na Androidzie glosy sa czescia systemu, wiec dziala takze offline.
 * Egzamin jest brytyjski, wiec szukamy glosu en-GB; gdy go nie ma, bierzemy
 * dowolny angielski, a gdy i tego nie ma - nie udajemy, ze mowa dziala.
 *
 * Wszystko jest opakowane w try/catch: to API bywa obecne, ale niesprawne
 * (WebView bez silnika mowy), a niemy przycisk nie moze wysadzic ekranu nauki.
 */

const PREFEROWANY_JEZYK = "en-GB";

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Lista glosow bywa pusta przy pierwszym pytaniu - przegladarka doczytuje ja
 * asynchronicznie. Trzymamy wiec wybor leniwie i odswiezamy, gdy lista
 * dojdzie.
 */
let wybrany: SpeechSynthesisVoice | null = null;

function glos(): SpeechSynthesisVoice | null {
  if (!speechAvailable()) return null;
  try {
    const glosy = window.speechSynthesis.getVoices();
    if (glosy.length === 0) return wybrany;
    if (!wybrany || !glosy.includes(wybrany)) {
      wybrany =
        glosy.find((g) => g.lang.replace("_", "-") === PREFEROWANY_JEZYK) ??
        glosy.find((g) => g.lang.toLowerCase().startsWith("en")) ??
        null;
    }
    return wybrany;
  } catch {
    return null;
  }
}

/** Czy da sie cokolwiek powiedziec po angielsku na tym urzadzeniu. */
export function englishVoiceReady(): boolean {
  return glos() !== null;
}

/**
 * Czyta tekst. Cichy no-op, gdy mowa niedostepna - wolajacy nie musi
 * sprawdzac niczego przed wywolaniem.
 */
export function speak(text: string): void {
  const czysty = text.trim();
  if (!czysty || !speechAvailable()) return;
  try {
    // Przerwanie poprzedniej wypowiedzi: podwojne stukniecie ma powtorzyc
    // slowo, nie ustawic je w kolejce.
    window.speechSynthesis.cancel();
    const wypowiedz = new SpeechSynthesisUtterance(czysty);
    const wybor = glos();
    if (wybor) wypowiedz.voice = wybor;
    wypowiedz.lang = wybor?.lang ?? PREFEROWANY_JEZYK;
    // Nieco wolniej niz domyslnie - chodzi o wzor do powtorzenia, nie
    // o naturalne tempo rozmowy.
    wypowiedz.rate = 0.92;
    window.speechSynthesis.speak(wypowiedz);
  } catch {
    // Silnik mowy nieobecny albo zablokowany - trudno.
  }
}

export function stopSpeaking(): void {
  if (!speechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // nie ma czego przerywac
  }
}
