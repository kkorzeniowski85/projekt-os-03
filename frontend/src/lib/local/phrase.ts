/**
 * Odnajdywanie uczonego zwrotu w zdaniu przykladowym.
 *
 * Sluzy dwóm rzeczom: podswietleniu zwrotu w przykladzie oraz zrobieniu
 * z tego zdania luki do uzupelnienia. Obie potrzebuja tego samego -
 * powiedziec, GDZIE w zdaniu stoi zwrot.
 *
 * Dopasowanie nie moze byc doslowne. Zwrot wystepuje odmieniony ("to fob
 * someone off" -> "keeps fobbing me off"), z konkretem w miejscu
 * placeholdera, a sam front bywa lista wariantow ("dizziness /
 * light-headedness") albo ma rozwiniecie skrotu w nawiasie ("pyrexia of
 * unknown origin (PUO)"). Kazda z tych form jest poprawnym uzyciem.
 *
 * Gdy nie ma pewnego dopasowania, zwracamy null - lepiej pokazac zdanie bez
 * podswietlenia niz podswietlic przypadkowe slowo. Przy luce brak
 * dopasowania oznacza, ze karty z luka po prostu nie ma.
 */

//: Slowa, ktore w zapisie zwrotu sa miejscem na cokolwiek ("fob SOMEONE
//: off") albo nie niosa tresci. Nie szukamy ich w zdaniu.
const PUSTE = new Set([
  "someone", "something", "somebody", "oneself", "one's", "sb", "sth",
  "a", "an", "the", "to", "of", "in", "on", "at", "with", "and", "for",
  "any", "be", "is", "are", "your", "his", "her", "my",
]);

//: Ile obcych slow wolno wpasc miedzy slowa zwrotu. "fob someone off" ->
//: "fobbing me off" to jedno; wiecej niz dwa i to juz nie jest ten zwrot,
//: tylko przypadkowa zbieznosc slow w dlugim zdaniu.
const MAX_PRZERWA = 2;

/**
 * Rdzen slowa - na tyle krotki, by przetrwac odmiane, na tyle dlugi, by nie
 * lapac obcych slow. "commenced" i "commencing" maja wspolne "commen";
 * "exacerbation" daje "exacerbat", wiec "exact" juz nie pasuje.
 */
function rdzen(slowo: string): string {
  return slowo.length <= 4 ? slowo : slowo.slice(0, Math.max(4, slowo.length - 3));
}

/** Wszystkie formy zapisu zwrotu: warianty po ukosniku i tresc nawiasow. */
export function warianty(front: string): string[] {
  const formy: string[] = [];
  for (const wNawiasie of front.matchAll(/\(([^)]*)\)/g)) formy.push(wNawiasie[1]);
  formy.push(...front.replace(/\([^)]*\)/g, " ").split("/"));
  return formy.map((f) => f.trim()).filter(Boolean);
}

//: Jedna definicja "slowa" po obu stronach porownania. Myslnik nalezy do
//: slowa: "light-headedness" to jedno pojecie, nie dwa, wiec tokenizacja
//: zdania i rozbior zwrotu musza widziec je tak samo.
//: Nowy obiekt przy kazdym wywolaniu - wyrazenie z flaga /g niesie stan
//: (lastIndex), wiec wspoldzielenie jednej instancji miedzy tokenizacja
//: zdania a rozbiorem zwrotu gubiloby dopasowania.
const slowa = () => /[a-zÀ-ſ'-]+/gi;

function slowaKluczowe(forma: string): string[] {
  return (forma.toLowerCase().match(slowa()) ?? []).filter(
    (slowo) => slowo.length > 2 && !PUSTE.has(slowo),
  );
}

interface Token {
  tekst: string;
  start: number;
  koniec: number;
}

function tokenizuj(zdanie: string): Token[] {
  const tokeny: Token[] = [];
  for (const m of zdanie.matchAll(slowa())) {
    tokeny.push({ tekst: m[0].toLowerCase(), start: m.index, koniec: m.index + m[0].length });
  }
  return tokeny;
}

export interface Dopasowanie {
  /** Indeks pierwszego znaku zwrotu w zdaniu. */
  start: number;
  /** Indeks za ostatnim znakiem zwrotu. */
  koniec: number;
}

/**
 * Szuka zwrotu w zdaniu. Zwraca NAJKROTSZE dopasowanie albo null.
 *
 * Najkrotsze, bo przy powtorzonym slowie ("The pain was localised... without
 * generalised peritonism") dluzszy zakres objalby pol zdania.
 */
export function findPhrase(zdanie: string, front: string): Dopasowanie | null {
  const tokeny = tokenizuj(zdanie);
  if (tokeny.length === 0) return null;

  let najlepsze: Dopasowanie | null = null;

  for (const forma of warianty(front)) {
    const rdzenie = slowaKluczowe(forma).map(rdzen);
    if (rdzenie.length === 0) continue;

    for (let poczatek = 0; poczatek < tokeny.length; poczatek += 1) {
      if (!tokeny[poczatek].tekst.startsWith(rdzenie[0])) continue;

      let pozycja = poczatek;
      let dopasowane = 1;
      for (let i = 1; i < rdzenie.length; i += 1) {
        let znaleziono = -1;
        for (let j = pozycja + 1; j <= Math.min(pozycja + 1 + MAX_PRZERWA, tokeny.length - 1); j += 1) {
          if (tokeny[j].tekst.startsWith(rdzenie[i])) {
            znaleziono = j;
            break;
          }
        }
        if (znaleziono < 0) break;
        pozycja = znaleziono;
        dopasowane += 1;
      }

      // Przy dluzszym zwrocie jedno slowo moze wypasc - zrodlo bywa zapisane
      // pelniej niz uzycie. Przy zwrocie dwuwyrazowym wymagamy obu: inaczej
      // "to rule out" zlapaloby samo "Rule" w zdaniu o rzadzeniu oddzialem.
      const wymagane = rdzenie.length <= 2 ? rdzenie.length : rdzenie.length - 1;
      if (dopasowane < wymagane) continue;

      const kandydat = { start: tokeny[poczatek].start, koniec: tokeny[pozycja].koniec };
      if (!najlepsze || kandydat.koniec - kandydat.start < najlepsze.koniec - najlepsze.start) {
        najlepsze = kandydat;
      }
    }
  }

  return najlepsze;
}

export interface Fragment {
  tekst: string;
  /** Czy to jest uczony zwrot. */
  zwrot: boolean;
}

/**
 * Dzieli zdanie na fragmenty do wyswietlenia: zwykly tekst i sam zwrot.
 * Bez dopasowania zwraca cale zdanie jako jeden zwykly fragment.
 */
export function splitOnPhrase(zdanie: string, front: string): Fragment[] {
  const trafienie = findPhrase(zdanie, front);
  if (!trafienie) return [{ tekst: zdanie, zwrot: false }];
  const fragmenty: Fragment[] = [];
  if (trafienie.start > 0) fragmenty.push({ tekst: zdanie.slice(0, trafienie.start), zwrot: false });
  fragmenty.push({ tekst: zdanie.slice(trafienie.start, trafienie.koniec), zwrot: true });
  if (trafienie.koniec < zdanie.length) {
    fragmenty.push({ tekst: zdanie.slice(trafienie.koniec), zwrot: false });
  }
  return fragmenty;
}

export const LUKA = "………";

/**
 * Zdanie z luka w miejscu zwrotu - do cwiczenia uzycia w kontekscie.
 * null, gdy zwrotu w zdaniu nie ma (wtedy luka nie mialaby czego sprawdzac).
 */
export function clozeSentence(zdanie: string, front: string): string | null {
  const trafienie = findPhrase(zdanie, front);
  if (!trafienie) return null;
  return zdanie.slice(0, trafienie.start) + LUKA + zdanie.slice(trafienie.koniec);
}

/**
 * Pierwsze zdanie przykladu nadajace sie na luke.
 *
 * Przyklad bywa wielolinijkowy i zaczyna sie od linii "Synonimy: ..." -
 * te pomijamy, bo nie sa zdaniem z uzyciem zwrotu.
 */
export function firstClozeLine(przyklad: string, front: string): string | null {
  for (const linia of przyklad.split("\n")) {
    const czysta = linia.trim();
    if (!czysta || /^(synonimy|formalnie)\b/i.test(czysta) || czysta.startsWith("/")) continue;
    const luka = clozeSentence(czysta, front);
    if (luka) return luka;
  }
  return null;
}
