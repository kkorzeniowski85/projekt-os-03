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

/** Klucz localStorage z glosem wybranym recznie (voiceURI) - osobno na kazdym urzadzeniu. */
const KLUCZ_GLOSU = "fiszki-glos-lektora";

type GlosOpis = Pick<SpeechSynthesisVoice, "name" | "lang" | "localService">;

export function isBritish(g: Pick<SpeechSynthesisVoice, "lang">): boolean {
  return g.lang.replace("_", "-").toLowerCase() === PREFEROWANY_JEZYK.toLowerCase();
}

/**
 * Ocena jakosci glosu po nazwie. Pierwszy z brzegu en-GB to na Windows zwykle
 * mechaniczny Hazel/George; neuronowe glosy maja w nazwie „Natural”/„Online”
 * (Edge) albo „Google” (Chrome), na Apple „Enhanced”/„Premium”.
 */
export function voiceScore(g: GlosOpis): number {
  const n = g.name;
  let s = 0;
  if (/natural/i.test(n)) s += 100;
  if (/online/i.test(n)) s += 40;
  if (/google/i.test(n)) s += 70;
  if (/enhanced|premium|neural|wavenet/i.test(n)) s += 60;
  if (g.localService === false) s += 20;
  if (/\b(hazel|george|susan)\b|espeak|e-speak/i.test(n)) s -= 60;
  return s;
}

/** Czy glos brzmi naturalnie (neuronowy / sieciowy dobrej jakosci). */
export function isNaturalVoice(g: GlosOpis): boolean {
  return voiceScore(g) >= 60;
}

/** Brytyjskie glosy tego urzadzenia, od najlepszego. */
export function britishVoices(): SpeechSynthesisVoice[] {
  if (!speechAvailable()) return [];
  try {
    return window.speechSynthesis
      .getVoices()
      .filter(isBritish)
      .sort((a, b) => voiceScore(b) - voiceScore(a));
  } catch {
    return [];
  }
}

function zapisanyGlos(): string | null {
  try {
    return window.localStorage.getItem(KLUCZ_GLOSU);
  } catch {
    return null;
  }
}

/** Reczny wybor glosu (voiceURI); null przywraca wybor automatyczny. */
export function setPreferredVoice(uri: string | null): void {
  try {
    if (uri) window.localStorage.setItem(KLUCZ_GLOSU, uri);
    else window.localStorage.removeItem(KLUCZ_GLOSU);
  } catch {
    // tryb prywatny - wybor obowiazuje tylko do zamkniecia
  }
  wybrany = null;
}

/** voiceURI glosu, ktorym aplikacja teraz czyta (albo null). */
export function currentVoiceUri(): string | null {
  return glos()?.voiceURI ?? null;
}

function glos(): SpeechSynthesisVoice | null {
  if (!speechAvailable()) return null;
  try {
    const glosy = window.speechSynthesis.getVoices();
    if (glosy.length === 0) return wybrany;
    if (!wybrany || !glosy.includes(wybrany)) {
      const brytyjskie = britishVoices();
      const chce = zapisanyGlos();
      wybrany =
        (chce ? brytyjskie.find((g) => g.voiceURI === chce) : undefined) ??
        brytyjskie[0] ??
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
    wypowiedz.rate = 0.95;
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
