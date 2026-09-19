/** Tempo pod termin egzaminu. */

import "fake-indexeddb/auto";

import { beforeEach, expect, it } from "vitest";

import { closeAndDeleteDb } from "./db";
import { BUFOR_DNI, examPace } from "./pace";
import { createDeck, createNote, setCardSuspended, submitReview, updateDeck } from "./repo";

const NOW = new Date("2026-09-19T10:00:00");

beforeEach(async () => {
  await closeAndDeleteDb();
});

async function fiszki(ile: number, newPerDay = 20) {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await updateDeck(deck.id, { newPerDay });
  const karty = [];
  for (let i = 0; i < ile; i += 1) {
    const { cards } = await createNote(
      { deckId: deck.id, noteType: "basic", fields: { Front: `slowo${i}`, Back: `word${i}` } },
      NOW,
    );
    karty.push(cards[0]);
  }
  return { deck, karty };
}

it("bez daty egzaminu nie liczy niczego", async () => {
  expect(await examPace(null, NOW)).toBeNull();
  expect(await examPace(undefined, NOW)).toBeNull();
});

it("liczy, ile nowych dziennie trzeba brac, z zapasem na utrwalenie", async () => {
  await fiszki(100, 20);
  // 51 dni do egzaminu, z czego 21 na samo utrwalanie -> 30 dni na material.
  const pace = (await examPace("2026-11-09", NOW))!;
  expect(pace.daysLeft).toBe(51);
  expect(pace.learningDays).toBe(51 - BUFOR_DNI);
  expect(pace.newCards).toBe(100);
  expect(pace.needPerDay).toBe(Math.ceil(100 / 30));
  expect(pace.onTrack).toBe(true); // 20 dziennie starczy z nawiazka
});

it("mowi wprost, gdy obecne tempo nie wystarcza", async () => {
  await fiszki(100, 2);
  const pace = (await examPace("2026-11-09", NOW))!;
  expect(pace.currentPerDay).toBe(2);
  expect(pace.onTrack).toBe(false);
});

it("material juz zaczety i odlozony na bok nie liczy sie jako nowy", async () => {
  const { karty } = await fiszki(10);
  await submitReview({ cardId: karty[0].id, rating: 3, durationMs: 1000, now: NOW });
  await setCardSuspended(karty[1].id, true, NOW);

  const pace = (await examPace("2026-11-09", NOW))!;
  expect(pace.newCards).toBe(8);
});

it("termin krotszy niz zapas na utrwalenie nadal daje sensowna liczbe", async () => {
  await fiszki(30);
  // 5 dni do egzaminu - zapasu nie ma, ale dzielenie przez zero tez nie.
  const pace = (await examPace("2026-09-24", NOW))!;
  expect(pace.learningDays).toBe(1);
  expect(pace.needPerDay).toBe(30);
  expect(pace.past).toBe(false);
});

it("egzamin dzis albo po egzaminie nie straszy liczbami", async () => {
  await fiszki(30);
  const dzis = (await examPace("2026-09-19", NOW))!;
  expect(dzis.past).toBe(true);
  expect(dzis.needPerDay).toBe(0);
  expect((await examPace("2026-09-01", NOW))!.past).toBe(true);
});
