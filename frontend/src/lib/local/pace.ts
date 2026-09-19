/**
 * Tempo pod termin egzaminu.
 *
 * Jedyna liczba, ktora naprawde interesuje kogos z data egzaminu w kalendarzu:
 * ile nowych fiszek dziennie trzeba brac, zeby zdazyc przerobic material -
 * i czy obecne ustawienie do tego wystarcza.
 *
 * Kluczowy szczegol: material trzeba nie tylko ZOBACZYC, ale i utrwalic.
 * Fiszka wzieta dzien przed egzaminem nie jest umiana. Dlatego od czasu, ktory
 * zostal, odejmujemy zapas na powtorki - ostatnie tygodnie ida na utrwalanie,
 * nie na nowy material.
 */

import { db } from "./db";
import { isNew } from "./scheduler";
import { dayStart } from "./time";

//: Ile ostatnich dni przed egzaminem zostawiamy na samo utrwalanie. Tyle,
//: ile FSRS uznaje za prog dojrzalosci karty (MATURE_STABILITY_DAYS w stats).
export const BUFOR_DNI = 21;

export interface PaceInfo {
  /** Dni od dzis do egzaminu (dzien egzaminu wlacznie). */
  daysLeft: number;
  /** Dni, ktore zostaja na branie nowego materialu. */
  learningDays: number;
  /** Ile nowych KART czeka (nie fiszek - fiszka ma ich dwie albo trzy). */
  newCards: number;
  /** Ile nowych kart dziennie trzeba brac, zeby zdazyc. */
  needPerDay: number;
  /** Sufit ustawiony w taliach - ile wolno wziac. */
  limitPerDay: number;
  /**
   * Ile nowych kart dziennie BIERZESZ naprawde - srednia z ostatniego
   * tygodnia, z logu powtorek. null, gdy nie ma jeszcze historii.
   * Sufit nie jest miara pracy: po tygodniu przerwy nadal wynosi 20.
   */
  actualPerDay: number | null;
  /** Czy tempo wystarcza - mierzone praca, a gdy jej brak, sufitem. */
  onTrack: boolean;
  /** Egzamin juz byl albo jest dzis. */
  past: boolean;
}

/** Liczba dni miedzy dwiema datami, licząc po granicy dnia nauki. */
function dniDo(examDate: string, now: Date): number {
  // Kotwica w poludnie - odejmowanie dob nie potyka sie o zmiane czasu.
  const cel = new Date(`${examDate}T12:00:00`);
  const dzis = dayStart(now);
  dzis.setHours(12, 0, 0, 0);
  return Math.round((cel.getTime() - dzis.getTime()) / (24 * 3600_000));
}

/**
 * Liczy tempo. Zwraca null, gdy nie ma daty egzaminu - wtedy aplikacja
 * o tempie nie wspomina.
 */
export async function examPace(
  examDate: string | null | undefined,
  now: Date = new Date(),
): Promise<PaceInfo | null> {
  if (!examDate) return null;

  const daysLeft = dniDo(examDate, now);
  const database = await db();

  let newCards = 0;
  for (const card of await database.getAll("cards")) {
    if (isNew(card.fsrs) && card.suspended !== true) newCards += 1;
  }
  let limitPerDay = 0;
  for (const deck of await database.getAll("decks")) limitPerDay += deck.newPerDay;

  // Realne tempo: ile RÓŻNYCH kart zobaczylo sie po raz pierwszy w ciagu
  // ostatnich siedmiu dni nauki. Liczone z logu, bo tylko on wie, co sie
  // naprawde wydarzylo.
  const tydzienTemu = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const swieze = new Set<string>();
  let najstarszaPowtorka: string | null = null;
  for (const wpis of await database.getAllFromIndex(
    "reviewLog",
    "by-time",
    IDBKeyRange.lowerBound(tydzienTemu),
  )) {
    if (najstarszaPowtorka === null) najstarszaPowtorka = wpis.reviewDatetime;
    if (wpis.stateBefore.state === 0) swieze.add(wpis.cardId);
  }
  // Dzielimy przez liczbe dni, ktore naprawde uplynely od pierwszej powtorki
  // w oknie - inaczej pierwszy dzien nauki pokazywalby jedna siodma tempa.
  const dniNauki = najstarszaPowtorka
    ? Math.max(
        1,
        Math.round((now.getTime() - new Date(najstarszaPowtorka).getTime()) / (24 * 3600_000)),
      )
    : 0;
  const actualPerDay = dniNauki > 0 ? Math.round((swieze.size / dniNauki) * 10) / 10 : null;

  if (daysLeft <= 0) {
    return {
      daysLeft,
      learningDays: 0,
      newCards,
      needPerDay: 0,
      limitPerDay,
      actualPerDay,
      onTrack: true,
      past: true,
    };
  }

  const learningDays = Math.max(1, daysLeft - BUFOR_DNI);
  const needPerDay = Math.ceil(newCards / learningDays);

  return {
    daysLeft,
    learningDays,
    newCards,
    needPerDay,
    limitPerDay,
    actualPerDay,
    // Praca jest miara, gdy jest co mierzyc. Bez historii zostaje sufit -
    // ale wtedy mowimy o mozliwosci, nie o fakcie.
    onTrack: actualPerDay !== null ? actualPerDay >= needPerDay : limitPerDay >= needPerDay,
    past: false,
  };
}
