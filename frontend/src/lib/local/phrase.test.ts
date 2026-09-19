/** Odnajdywanie uczonego zwrotu w zdaniu: podswietlenie i luka. */

import { expect, it } from "vitest";

import { LUKA, clozeSentence, findPhrase, firstClozeLine, splitOnPhrase } from "./phrase";

const zwrot = (zdanie: string, front: string) => {
  const t = findPhrase(zdanie, front);
  return t ? zdanie.slice(t.start, t.koniec) : null;
};

it("znajduje zwrot doslownie i w odmianie", () => {
  expect(zwrot("We need to rule out a bleed.", "to rule out")).toBe("rule out");
  expect(zwrot("The council keeps fobbing me off with excuses.", "to fob someone off")).toBe(
    "fobbing me off",
  );
  // Przyimek "on" jest wypelniaczem jak "someone" - podswietlamy slowo niosace
  // tresc, nie cala konstrukcje.
  expect(zwrot("He was commenced on insulin.", "to be commenced on (medication)")).toBe(
    "commenced",
  );
  expect(zwrot("The patient was pyrexial on admission.", "pyrexia")).toBe("pyrexial");
});

it("radzi sobie z wariantami po ukosniku i skrotem w nawiasie", () => {
  expect(zwrot("She reports light-headedness on standing.", "dizziness / light-headedness")).toBe(
    "light-headedness",
  );
  expect(zwrot("His PUO remains unexplained.", "pyrexia of unknown origin (PUO)")).toBe("PUO");
});

it("nie zgaduje, gdy zwrotu w zdaniu nie ma", () => {
  expect(findPhrase("The diagnosis was uncertain at that point.", "to rule out")).toBeNull();
  expect(findPhrase("Nothing relevant here.", "exacerbation")).toBeNull();
  // Podobne slowo to nie to samo slowo.
  expect(findPhrase("The measurement was exact.", "exacerbation")).toBeNull();
});

it("wybiera najkrotsze dopasowanie", () => {
  // Bez tego zakres objalby pol zdania, bo slowo powtarza sie pozniej.
  expect(zwrot("The pain was localised, not generalised, and localised again.", "localised")).toBe(
    "localised",
  );
});

it("nie laczy slow odleglych o pol zdania", () => {
  expect(
    findPhrase("Rule the ward with an iron fist and never go out.", "to rule out"),
  ).toBeNull();
});

it("dzieli zdanie na fragmenty do podswietlenia", () => {
  expect(splitOnPhrase("We need to rule out a bleed.", "to rule out")).toEqual([
    { tekst: "We need to ", zwrot: false },
    { tekst: "rule out", zwrot: true },
    { tekst: " a bleed.", zwrot: false },
  ]);
  // Bez dopasowania - cale zdanie bez wyroznienia.
  expect(splitOnPhrase("Nothing here.", "to rule out")).toEqual([
    { tekst: "Nothing here.", zwrot: false },
  ]);
});

it("robi luke w miejscu zwrotu", () => {
  expect(clozeSentence("We need to rule out a bleed.", "to rule out")).toBe(
    `We need to ${LUKA} a bleed.`,
  );
  expect(clozeSentence("The diagnosis was uncertain.", "to rule out")).toBeNull();
});

it("bierze pierwsze zdanie przykladu, pomijajac linie synonimow", () => {
  const przyklad = "Synonimy: to exclude / to eliminate\n\nWe need to rule out a bleed.";
  expect(firstClozeLine(przyklad, "to rule out")).toBe(`We need to ${LUKA} a bleed.`);
  // Same synonimy nie daja luki.
  expect(firstClozeLine("Synonimy: to exclude", "to rule out")).toBeNull();
});
