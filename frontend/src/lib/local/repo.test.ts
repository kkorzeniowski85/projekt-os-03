/**
 * Testy warstwy operacji na IndexedDB (fake-indexeddb, bez przegladarki).
 * Kazdy test dostaje swieza baze.
 */

import "fake-indexeddb/auto";

import { beforeEach, expect, it } from "vitest";

import { contentHash } from "./content";
import { closeAndDeleteDb } from "./db";
import {
  createDeck,
  createNote,
  deleteDeck,
  deleteNote,
  findDuplicateByHash,
  listDecks,
  listNotes,
  mergeDecks,
  studyQueue,
  submitReview,
  updateDeck,
  updateNote,
} from "./repo";
import { db } from "./db";

const NOW = new Date("2026-08-03T12:00:00");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

beforeEach(async () => {
  await closeAndDeleteDb();
});

// --- talie i notatki -------------------------------------------------------

it("notatka dwustronna daje dwie karty, jednostronna jedna", async () => {
  const deck = await createDeck({ name: "Angielski" }, NOW);

  const twoSided = await createNote(
    { deckId: deck.id, noteType: "basic_reversed", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  expect(twoSided.cards.map((c) => c.templateOrd)).toEqual([0, 1]);

  const oneSided = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "pies", Back: "dog" } },
    NOW,
  );
  expect(oneSided.cards).toHaveLength(1);

  const decks = await listDecks(NOW);
  expect(decks[0].counts).toEqual({ new: 3, due: 0, total: 3 });
});

it("kategoria materialu jest zgadywana z przodu, jawna wygrywa", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);

  const guessed = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  expect(guessed.note.itemKind).toBe("word");

  const explicit = await createNote(
    {
      deckId: deck.id,
      noteType: "basic",
      fields: { Front: "kick the bucket", Back: "kopnac w kalendarz" },
      itemKind: "expression",
    },
    NOW,
  );
  expect(explicit.note.itemKind).toBe("expression");
});

it("duplikat jest rozpoznawany mimo roznic formatowania", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { note } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );

  const hash = await contentHash({ Front: "  KOT ", Back: "cat" });
  expect((await findDuplicateByHash(hash))?.id).toBe(note.id);
});

it("pusta strona notatki jest odrzucana", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await expect(
    createNote({ deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "  " } }, NOW),
  ).rejects.toThrow("przod i tyl");
});

it("dwie talie o tej samej nazwie sa zabronione", async () => {
  await createDeck({ name: "Angielski" }, NOW);
  await expect(createDeck({ name: "Angielski" }, NOW)).rejects.toThrow("juz istnieje");
});

it("zmiana typu notatki dosztukowuje i usuwa karty bez ruszania istniejacych", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { note, cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  const originalCardId = cards[0].id;

  await updateNote(note.id, { noteType: "basic_reversed" }, at(1));
  let listed = (await listNotes(deck.id))[0];
  expect(listed.cards).toHaveLength(2);
  // Karta ord=0 przezyla zmiane - jej stan FSRS nie zostal zresetowany.
  expect(listed.cards[0].id).toBe(originalCardId);

  await updateNote(note.id, { noteType: "basic" }, at(2));
  listed = (await listNotes(deck.id))[0];
  expect(listed.cards).toHaveLength(1);
  expect(listed.cards[0].id).toBe(originalCardId);
});

// --- kolejka ---------------------------------------------------------------

it("kolejka szanuje dzienny limit nowych kart", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await updateDeck(deck.id, { newPerDay: 2 });
  for (const front of ["a", "b", "c"]) {
    await createNote({ deckId: deck.id, noteType: "basic", fields: { Front: front, Back: "x" } }, NOW);
  }

  const queue = await studyQueue(deck.id, { now: NOW });
  expect(queue.cards).toHaveLength(2);
  expect(queue.newRemaining).toBe(2);
  expect(queue.dueRemaining).toBe(0);
});

it("ocena zapisuje log, a kolejka liczy dzisiejsze nowe karty", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  await updateDeck(deck.id, { newPerDay: 2 });
  for (const front of ["a", "b", "c"]) {
    await createNote({ deckId: deck.id, noteType: "basic", fields: { Front: front, Back: "x" } }, NOW);
  }

  const first = (await studyQueue(deck.id, { now: NOW })).cards[0];
  const { card, log } = await submitReview({
    cardId: first.card.id,
    rating: 3,
    durationMs: 4200,
    now: NOW,
  });

  expect(log.stateBefore.state).toBe(0); // karta byla nowa
  expect(log.stateAfter.state).not.toBe(0);
  expect(log.itemKind).toBe("word");
  expect(log.deckId).toBe(deck.id);
  expect(log.durationMs).toBe(4200);
  expect(card.due).toBe(card.fsrs.due);

  // Jedna nowa karta "zuzyta" dzis -> zostal 1 slot na nowe.
  const queue = await studyQueue(deck.id, { now: at(1) });
  expect(queue.newRemaining).toBe(1);
  const ids = queue.cards.map((entry) => entry.card.id);
  expect(ids).not.toContain(first.card.id); // wroci dopiero w swoim terminie
});

it("zalegle karty wracaja do kolejki przed nowymi", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  await createNote({ deckId: deck.id, noteType: "basic", fields: { Front: "pies", Back: "dog" } }, NOW);

  const reviewed = await submitReview({ cardId: cards[0].id, rating: 3, durationMs: 1000, now: NOW });

  // Chwile po terminie: oceniona karta jest zalegla i stoi przed nowa.
  const later = new Date(new Date(reviewed.card.due).getTime() + 60_000);
  const queue = await studyQueue(deck.id, { now: later });
  expect(queue.cards[0].card.id).toBe(cards[0].id);
  expect(queue.dueRemaining).toBe(1);
});

it("ocena bez czasu odpowiedzi jest odrzucana", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  await expect(
    submitReview({ cardId: cards[0].id, rating: 3, durationMs: Number.NaN, now: NOW }),
  ).rejects.toThrow("durationMs");
});

// --- kasowanie a historia --------------------------------------------------

it("skasowanie notatki nie kasuje historii powtorek", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { note, cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  await submitReview({ cardId: cards[0].id, rating: 3, durationMs: 1000, now: NOW });

  await deleteNote(note.id);

  const database = await db();
  expect(await database.getAllFromIndex("cards", "by-note", note.id)).toHaveLength(0);
  const history = await database.getAllFromIndex("reviewLog", "by-card", cards[0].id);
  expect(history).toHaveLength(1);
  expect(history[0].itemKind).toBe("word"); // denormalizacja robi swoje
});

it("skasowanie talii zabiera notatki i karty, zostawia log", async () => {
  const deck = await createDeck({ name: "Talia" }, NOW);
  const { cards } = await createNote(
    { deckId: deck.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  await submitReview({ cardId: cards[0].id, rating: 3, durationMs: 1000, now: NOW });

  await deleteDeck(deck.id);

  const database = await db();
  expect(await database.getAll("decks")).toHaveLength(0);
  expect(await database.getAll("notes")).toHaveLength(0);
  expect(await database.getAll("cards")).toHaveLength(0);
  expect(await database.getAll("reviewLog")).toHaveLength(1);
});

// --- wspolna kolejka z wielu talii -----------------------------------------
//
// "Jedna masa slowek": karty z kilku talii mieszaja sie w jeden strumien,
// ale limity dzienne zostaja przy swoich taliach - inaczej jedna talia
// zjadalaby dzienny przydzial nowych kart innej.

async function deckWithNotes(name: string, fronts: string[], now = NOW) {
  const deck = await createDeck({ name }, now);
  // Kolejne notatki co sekunde - tak jak przy prawdziwym dodawaniu, gdzie
  // kazde wywolanie ma wlasny czas.
  for (const [i, front] of fronts.entries()) {
    await createNote(
      { deckId: deck.id, noteType: "basic", fields: { Front: front, Back: "x" } },
      new Date(now.getTime() + i * 1000),
    );
  }
  return deck;
}

it("nauka ze wszystkich talii miesza karty w jeden strumien", async () => {
  const a = await deckWithNotes("Angielski", ["a1", "a2"]);
  const b = await deckWithNotes("NHS", ["b1", "b2"]);

  const queue = await studyQueue("all", { now: NOW });

  expect(queue.deckIds.sort()).toEqual([a.id, b.id].sort());
  expect(queue.cards).toHaveLength(4);
  expect(new Set(queue.cards.map((e) => e.deckName))).toEqual(new Set(["Angielski", "NHS"]));
  expect(queue.newRemaining).toBe(4);
});

it("kazda karta wie, z ktorej talii pochodzi", async () => {
  await deckWithNotes("Angielski", ["kot"]);
  await deckWithNotes("NHS", ["obs"]);

  const queue = await studyQueue("all", { now: NOW });
  const byFront = new Map(queue.cards.map((e) => [e.note.fields.Front, e.deckName]));

  expect(byFront.get("kot")).toBe("Angielski");
  expect(byFront.get("obs")).toBe("NHS");
});

it("mozna wybrac podzbior talii", async () => {
  const a = await deckWithNotes("Angielski", ["a1"]);
  await deckWithNotes("NHS", ["b1"]);
  const c = await deckWithNotes("Hiszpanski", ["c1"]);

  const queue = await studyQueue([a.id, c.id], { now: NOW });

  expect(queue.cards).toHaveLength(2);
  expect(new Set(queue.cards.map((e) => e.deckName))).toEqual(
    new Set(["Angielski", "Hiszpanski"]),
  );
});

it("limit dzienny jednej talii nie zjada przydzialu drugiej", async () => {
  const a = await deckWithNotes("Angielski", ["a1", "a2", "a3"]);
  const b = await deckWithNotes("NHS", ["b1", "b2", "b3"]);
  await updateDeck(a.id, { newPerDay: 1 });
  await updateDeck(b.id, { newPerDay: 2 });

  const queue = await studyQueue("all", { now: NOW });

  // 1 z pierwszej + 2 z drugiej, nie 3 z tej, ktora akurat byla pierwsza.
  expect(queue.cards).toHaveLength(3);
  const licznik = new Map<string, number>();
  for (const entry of queue.cards) {
    licznik.set(entry.deckName, (licznik.get(entry.deckName) ?? 0) + 1);
  }
  expect(licznik.get("Angielski")).toBe(1);
  expect(licznik.get("NHS")).toBe(2);
  expect(queue.newRemaining).toBe(3);
});

it("zalegle ze wszystkich talii ida przed nowymi, wg terminu", async () => {
  const a = await deckWithNotes("Angielski", ["a1"]);
  const b = await deckWithNotes("NHS", ["b1"]);
  await deckWithNotes("Nowa", ["c1"]);

  // Obie karty ocenione - wracaja jako zalegle, kazda w swoim terminie.
  const qa = await studyQueue(a.id, { now: NOW });
  const rb = await submitReview({
    cardId: (await studyQueue(b.id, { now: NOW })).cards[0].card.id,
    rating: 4,
    durationMs: 1000,
    now: NOW,
  });
  await submitReview({ cardId: qa.cards[0].card.id, rating: 3, durationMs: 1000, now: NOW });

  const later = new Date(new Date(rb.card.due).getTime() + 60_000);
  const queue = await studyQueue("all", { now: later });

  // Pierwsze dwie pozycje to zalegle (posortowane po terminie), nowa na koncu.
  expect(queue.cards.slice(0, 2).every((e) => e.card.fsrs.state !== 0)).toBe(true);
  expect(queue.cards[2].note.fields.Front).toBe("c1");
  const terminy = queue.cards.slice(0, 2).map((e) => e.card.due);
  expect([...terminy].sort()).toEqual(terminy);
});

it("wskazanie nieistniejacej talii jest bledem, ale brak talii w ogole nie", async () => {
  await expect(studyQueue("nie-ma-takiej", { now: NOW })).rejects.toThrow("talii");
  const puste = await studyQueue("all", { now: NOW });
  expect(puste.cards).toHaveLength(0);
  expect(puste.deckIds).toEqual([]);
});

it("nowe karty przeplataja sie miedzy taliami, nie ida blokami", async () => {
  // Import idzie talia po talii, wiec bez przeplatania kolejka ulozylaby sie
  // w bloki i wspolna nauka niczym nie roznilaby sie od nauki po kolei.
  await deckWithNotes("Pierwsza", ["p1", "p2", "p3"]);
  await deckWithNotes("Druga", ["d1", "d2", "d3"]);
  await deckWithNotes("Trzecia", ["t1", "t2", "t3"]);

  const queue = await studyQueue("all", { now: NOW, limit: 9 });
  const talie = queue.cards.map((e) => e.deckName);

  // Pierwsze trzy karty musza pochodzic z trzech roznych talii.
  expect(new Set(talie.slice(0, 3)).size).toBe(3);
  // Zadne trzy pod rzad nie moga byc z tej samej talii.
  for (let i = 0; i + 2 < talie.length; i += 1) {
    expect(new Set(talie.slice(i, i + 3)).size).toBeGreaterThan(1);
  }
});

it("przeplatanie radzi sobie z taliami o roznej wielkosci", async () => {
  await deckWithNotes("Duza", ["a1", "a2", "a3", "a4"]);
  await deckWithNotes("Mala", ["b1"]);

  const queue = await studyQueue("all", { now: NOW, limit: 10 });

  expect(queue.cards).toHaveLength(5);
  expect(queue.cards[0].deckName).toBe("Duza");
  expect(queue.cards[1].deckName).toBe("Mala");
  // Po wyczerpaniu malej talii reszta idzie z duzej, bez luk.
  expect(queue.cards.slice(2).every((e) => e.deckName === "Duza")).toBe(true);
});

it("w obrebie talii kolejnosc dodania zostaje zachowana", async () => {
  await deckWithNotes("Talia", ["pierwsza", "druga", "trzecia"]);

  const queue = await studyQueue("all", { now: NOW, limit: 10 });

  expect(queue.cards.map((e) => e.note.fields.Front)).toEqual([
    "pierwsza",
    "druga",
    "trzecia",
  ]);
});

// --- trwale laczenie talii --------------------------------------------------

it("laczenie przenosi fiszki i kasuje puste zrodla", async () => {
  const target = await deckWithNotes("OET", ["a1", "a2"]);
  const source = await deckWithNotes("NHS", ["b1", "b2", "b3"]);

  const wynik = await mergeDecks(target.id, [source.id], NOW);

  expect(wynik.movedNotes).toBe(3);
  expect(wynik.removedDecks).toBe(1);
  expect(wynik.deckName).toBe("OET");

  const decks = await listDecks(NOW);
  expect(decks).toHaveLength(1);
  expect(decks[0].name).toBe("OET");
  expect(decks[0].counts.total).toBe(5);
  expect((await listNotes(target.id))).toHaveLength(5);
});

it("laczenie zachowuje stan powtorek karty", async () => {
  const target = await deckWithNotes("Docelowa", ["x"]);
  const source = await deckWithNotes("Zrodlowa", ["nauczona"]);
  const karta = (await studyQueue(source.id, { now: NOW })).cards[0].card;
  const po = await submitReview({ cardId: karta.id, rating: 4, durationMs: 3000, now: NOW });

  await mergeDecks(target.id, [source.id], NOW);

  const database = await db();
  const przeniesiona = (await database.get("cards", karta.id))!;
  expect(przeniesiona.deckId).toBe(target.id);
  expect(przeniesiona.fsrs.state).toBe(po.card.fsrs.state);
  expect(przeniesiona.fsrs.reps).toBe(1);
  expect(przeniesiona.due).toBe(po.card.due);
});

it("historia nauki idzie za materialem do nowej talii", async () => {
  const target = await deckWithNotes("Docelowa", ["x"]);
  const source = await deckWithNotes("Zrodlowa", ["y"]);
  const karta = (await studyQueue(source.id, { now: NOW })).cards[0].card;
  await submitReview({ cardId: karta.id, rating: 3, durationMs: 2000, now: NOW });

  const wynik = await mergeDecks(target.id, [source.id], NOW);

  expect(wynik.movedReviews).toBe(1);
  // Statystyki talii docelowej obejmuja nauke sprzed polaczenia.
  const database = await db();
  const log = await database.getAll("reviewLog");
  expect(log.every((e) => e.deckId === target.id)).toBe(true);
});

it("laczenie zlicza duplikaty, ale ich nie kasuje", async () => {
  const target = await createDeck({ name: "Docelowa" }, NOW);
  await createNote(
    { deckId: target.id, noteType: "basic", fields: { Front: "kot", Back: "cat" } },
    NOW,
  );
  const source = await createDeck({ name: "Zrodlowa" }, NOW);
  await createNote(
    { deckId: source.id, noteType: "basic", fields: { Front: "  KOT ", Back: "cat" } },
    NOW,
  );
  await createNote(
    { deckId: source.id, noteType: "basic", fields: { Front: "pies", Back: "dog" } },
    NOW,
  );

  const wynik = await mergeDecks(target.id, [source.id], NOW);

  expect(wynik.duplicates).toBe(1);
  // Nic nie przepadlo - decyzja o usunieciu nalezy do uzytkownika.
  expect(await listNotes(target.id)).toHaveLength(3);
});

it("mozna polaczyc kilka talii naraz", async () => {
  const target = await deckWithNotes("Glowna", ["a"]);
  const b = await deckWithNotes("Druga", ["b"]);
  const c = await deckWithNotes("Trzecia", ["c"]);

  const wynik = await mergeDecks(target.id, [b.id, c.id], NOW);

  expect(wynik.removedDecks).toBe(2);
  expect(wynik.movedNotes).toBe(2);
  expect(await listDecks(NOW)).toHaveLength(1);
  expect(await listNotes(target.id)).toHaveLength(3);
});

it("laczenie talii ze soba samą jest odrzucane", async () => {
  const deck = await deckWithNotes("Jedyna", ["a"]);
  await expect(mergeDecks(deck.id, [deck.id], NOW)).rejects.toThrow("co najmniej jedna");
  expect(await listDecks(NOW)).toHaveLength(1);
});
