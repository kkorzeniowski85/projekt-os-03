/**
 * Rozbior starego pola "przyklad" na osobne czesci.
 *
 * Historia: material z trackerow OET wchodzil do aplikacji, gdy notatka miala
 * tylko trzy pola (przod, tyl, przyklad). Wymowa, synonimy i odpowiednik
 * formalny nie mialy gdzie mieszkac, wiec zostaly SKLEJONE w przyklad,
 * linia po linii. Teraz maja wlasne pola i ten sklej trzeba rozplatac -
 * zarowno w bazie uzytkownika (migracja), jak i przy generowaniu pakietu.
 *
 * Ksztalt, ktory rozbieramy (zmierzony na 229 fiszkach pakietu - wszystkie
 * 229 pasuja do jednego z dwoch wariantow, bez wyjatkow):
 *
 *   /tə tʃeɪz ʌp/                              <- wymowa, zawsze pierwsza linia
 *   Formalnie (OET): to follow up on           <- odpowiednik formalny
 *                                              <- pusta linia
 *   I'll chase up the agent tomorrow.          <- wlasciwe zdania
 *
 *   Synonimy: to exclude / to eliminate        <- albo synonimy
 *                                              <- pusta linia
 *   We need to rule out a bleed.
 *
 * Rozbior jest ZACHOWAWCZY: linia, ktorej nie rozpoznajemy, zostaje
 * przykladem. Lepiej zostawic cos w przykladzie niz zgubic tresc, ktorej
 * uzytkownik nie da sie juz odtworzyc.
 */

export interface SplitExample {
  /** Zapis wymowy, zwykle w slashach. */
  pronunciation: string;
  /** Synonimy albo blizsze opisy znaczenia. */
  synonyms: string;
  /** Odpowiednik formalny - rejestr, ktorego wymaga OET. */
  formal: string;
  /** To, co zostalo: wlasciwe zdania przykladowe. */
  example: string;
}

const PUSTY: SplitExample = { pronunciation: "", synonyms: "", formal: "", example: "" };

//: Naglowki dopuszczaja polska i angielska pisownie oraz brak dwukropka po
//: nawiasie - zrodla bywaly redagowane recznie.
const SYNONIMY = /^(synonimy|synonyms)\s*:\s*/i;
const FORMALNIE = /^(formalnie|formally)\b[^:]*:\s*/i;

/** Linia wygladajaca na zapis wymowy: w slashach albo w nawiasach kwadratowych. */
function czyWymowa(linia: string): boolean {
  const t = linia.trim();
  if (t.length < 2) return false;
  return (t.startsWith("/") && t.endsWith("/")) || (t.startsWith("[") && t.endsWith("]"));
}

/**
 * Rozbiera przyklad na czesci. Tresci nie gubi: czego nie rozpozna, zostawia
 * w polu `example`.
 */
export function splitLegacyExample(raw: string | undefined | null): SplitExample {
  if (!raw || !raw.trim()) return PUSTY;

  const wymowa: string[] = [];
  const synonimy: string[] = [];
  const formalne: string[] = [];
  const reszta: string[] = [];

  for (const linia of raw.split("\n")) {
    const czysta = linia.trim();
    if (SYNONIMY.test(czysta)) {
      synonimy.push(czysta.replace(SYNONIMY, "").trim());
    } else if (FORMALNIE.test(czysta)) {
      formalne.push(czysta.replace(FORMALNIE, "").trim());
    } else if (czyWymowa(czysta) && reszta.length === 0) {
      // Tylko zanim zaczna sie zdania - slash w srodku zdania to nie wymowa.
      wymowa.push(czysta);
    } else {
      reszta.push(linia);
    }
  }

  return {
    pronunciation: wymowa.join(" ").trim(),
    synonyms: synonimy.join(" / ").trim(),
    formal: formalne.join(" / ").trim(),
    // Puste linie na brzegach zostaja po wycietych naglowkach.
    example: reszta.join("\n").replace(/^\s*\n+/, "").replace(/\n+\s*$/, ""),
  };
}

/** Czy w tym przykladzie jest cokolwiek do wydzielenia. */
export function hasLegacyParts(raw: string | undefined | null): boolean {
  const podzial = splitLegacyExample(raw);
  return Boolean(podzial.pronunciation || podzial.synonyms || podzial.formal);
}
