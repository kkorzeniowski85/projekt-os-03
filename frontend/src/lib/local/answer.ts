/**
 * Porownanie wpisanej odpowiedzi z wzorcem.
 *
 * Po co w ogole wpisywac: OET wymaga brytyjskiej pisowni (diarrhoea, oedema,
 * haemoptysis). Rozpoznanie zwrotu na karcie tego nie cwiczy - dopiero
 * napisanie go pokazuje, czy pisownia siedzi.
 *
 * Nie oceniamy za uzytkownika: wynik porownania jest tylko pokazywany, ocene
 * wybiera czlowiek. Automat nie wie, czy literowka to potkniecie palca, czy
 * brak wiedzy, a FSRS opiera sie na szczerej samoocenie.
 */

/** Fragment odpowiedzi z informacja, czy zgadza sie ze wzorcem. */
export interface AnswerPart {
  text: string;
  ok: boolean;
}

export interface AnswerVerdict {
  /** Po normalizacji identyczne ze wzorcem. */
  exact: boolean;
  /** Rozni sie najwyzej drobiazgiem - literowka albo koncowka. */
  close: boolean;
  /** Wpisany tekst rozbity na fragmenty zgodne i niezgodne. */
  parts: AnswerPart[];
}

/**
 * Do porownania nie licza sie wielkosc liter, interpunkcja ani powtorzone
 * spacje. "To rule out." i "to rule out" to ta sama odpowiedz - roznica jest
 * w zapisie, nie w wiedzy.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Odleglosc edycyjna z wczesnym wyjsciem - interesuja nas tylko male roznice. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let poprzedni = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const biezacy = [i];
    let najlepszy = i;
    for (let j = 1; j <= b.length; j += 1) {
      const koszt = a[i - 1] === b[j - 1] ? 0 : 1;
      const wartosc = Math.min(
        poprzedni[j] + 1,
        biezacy[j - 1] + 1,
        poprzedni[j - 1] + koszt,
      );
      biezacy.push(wartosc);
      if (wartosc < najlepszy) najlepszy = wartosc;
    }
    if (najlepszy > max) return max + 1;
    poprzedni = biezacy;
  }
  return poprzedni[b.length];
}

/**
 * Rozbija wpisany tekst na fragmenty zgodne i niezgodne ze wzorcem.
 *
 * Porownujemy slowo po slowie, nie litera po literze: przy literowce w srodku
 * wyrazu podswietlenie pojedynczych liter daje szachownice, z ktorej nic nie
 * wynika. Cale bledne slowo widac od razu.
 */
export function compareAnswer(typed: string, expected: string): AnswerVerdict {
  const wpisane = normalize(typed);
  const wzorzec = normalize(expected);

  if (wpisane === wzorzec) {
    return { exact: true, close: true, parts: [{ text: typed.trim(), ok: true }] };
  }

  const slowaWpisane = typed.trim().split(/(\s+)/);
  const slowaWzorca = new Set(wzorzec.split(" "));
  const parts: AnswerPart[] = [];
  for (const kawalek of slowaWpisane) {
    if (!kawalek) continue;
    if (/^\s+$/.test(kawalek)) {
      parts.push({ text: kawalek, ok: true });
      continue;
    }
    const czyste = normalize(kawalek);
    parts.push({ text: kawalek, ok: czyste !== "" && slowaWzorca.has(czyste) });
  }

  // "Prawie" to jedna-dwie litery roznicy w calej odpowiedzi - tyle, ile
  // dzieli "diarrhea" od "diarrhoea". Wiecej to juz inna odpowiedz.
  const prog = wzorzec.length <= 6 ? 1 : 2;
  const close = wpisane !== "" && distance(wpisane, wzorzec, prog) <= prog;

  return { exact: false, close, parts };
}
