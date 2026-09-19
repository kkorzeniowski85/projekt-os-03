/**
 * Ustawienia ekranu nauki - preferencje urzadzenia, nie dane nauki.
 *
 * Swiadomie w localStorage, nie w IndexedDB: to, czy telefon ma czytac
 * slowka na glos, zalezy od tego konkretnego urzadzenia (sluchawki, glosniki,
 * silnik mowy), a nie od kolekcji. Kopia zapasowa przenosi nauke, nie
 * preferencje sprzetu.
 *
 * Kazdy odczyt i zapis w try/catch - w trybie prywatnym albo przy
 * zablokowanych danych stron localStorage rzuca wyjatek.
 */

const KLUCZ = "fiszki:nauka";

export interface StudyPrefs {
  /** Czytaj angielska strone od razu po odslonieciu odpowiedzi. */
  autoSpeak: boolean;
  /** Przy kierunku polski -> angielski wpisuj odpowiedz zamiast oceniac z glowy. */
  typeAnswer: boolean;
  /** Przy produkcji pokaz zdanie przykladowe z luka jako kontekst. */
  showCloze: boolean;
}

export const DEFAULT_PREFS: StudyPrefs = {
  autoSpeak: false,
  typeAnswer: false,
  showCloze: true,
};

export function loadPrefs(): StudyPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KLUCZ);
    if (!raw) return DEFAULT_PREFS;
    const zapisane = JSON.parse(raw) as Partial<StudyPrefs>;
    // Pole po polu, nie spread calosci: uszkodzony albo starszy zapis nie
    // moze wstawic w ustawienia czegos, co nie jest wartoscia logiczna.
    return {
      autoSpeak: typeof zapisane.autoSpeak === "boolean" ? zapisane.autoSpeak : DEFAULT_PREFS.autoSpeak,
      typeAnswer:
        typeof zapisane.typeAnswer === "boolean" ? zapisane.typeAnswer : DEFAULT_PREFS.typeAnswer,
      showCloze:
        typeof zapisane.showCloze === "boolean" ? zapisane.showCloze : DEFAULT_PREFS.showCloze,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: StudyPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KLUCZ, JSON.stringify(prefs));
  } catch {
    // Brak miejsca albo tryb prywatny - ustawienie zadziala do konca sesji.
  }
}
