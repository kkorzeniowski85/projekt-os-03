/** Rozbior starego, sklejonego pola "przyklad" na osobne czesci. */

import { expect, it } from "vitest";

import { hasLegacyParts, splitLegacyExample } from "./legacy-example";

it("rozbiera wariant z synonimami (143 fiszki pakietu)", () => {
  const raw =
    "Synonimy: to exclude / to eliminate\n\nWe need to rule out a bleed.\nRule out sepsis first.";
  expect(splitLegacyExample(raw)).toEqual({
    pronunciation: "",
    synonyms: "to exclude / to eliminate",
    formal: "",
    example: "We need to rule out a bleed.\nRule out sepsis first.",
  });
});

it("rozbiera wariant z wymowa i odpowiednikiem formalnym (86 fiszek pakietu)", () => {
  const raw =
    "/tə tʃeɪz ʌp/\nFormalnie (OET): to follow up on / to enquire about\n\nI'll chase up the agent.";
  expect(splitLegacyExample(raw)).toEqual({
    pronunciation: "/tə tʃeɪz ʌp/",
    synonyms: "",
    formal: "to follow up on / to enquire about",
    example: "I'll chase up the agent.",
  });
});

it("zdanie bez naglowkow zostaje w calosci przykladem", () => {
  const raw = "We need to rule out a bleed.\nAnother sentence.";
  expect(splitLegacyExample(raw)).toEqual({ ...splitLegacyExample(""), example: raw });
  expect(hasLegacyParts(raw)).toBe(false);
});

it("ukosnik w srodku zdania nie jest brany za wymowe", () => {
  // "and/or" ani data nie moga trafic do pola wymowy.
  const raw = "Synonimy: x\n\nCheck the and/or clause.\n/not pronunciation/";
  const wynik = splitLegacyExample(raw);
  expect(wynik.pronunciation).toBe("");
  expect(wynik.example).toBe("Check the and/or clause.\n/not pronunciation/");
});

it("naglowek PO zdaniach zostaje w przykladzie", () => {
  // Skanujemy wylacznie poczatek pola. "Synonimy:" wpisane przez uzytkownika
  // w srodku wlasnego tekstu nie moze zostac wyciete ze srodka tego tekstu.
  const raw = "Uwaga redaktora bez naglowka\nSynonimy: x\n\nZdanie.";
  const wynik = splitLegacyExample(raw);
  expect(wynik.synonyms).toBe("");
  expect(wynik.example).toBe(raw);
});

it("nie zjada zdania zaczynajacego sie od slowa 'Formally'", () => {
  const raw = "Formally, the patient was discharged: no follow-up needed.";
  const wynik = splitLegacyExample(raw);
  expect(wynik.formal).toBe("");
  expect(wynik.example).toBe(raw);
});

it("przyjmuje warianty zapisu naglowkow", () => {
  expect(splitLegacyExample("Synonyms: a, b\n\nS.").synonyms).toBe("a, b");
  expect(splitLegacyExample("Formalnie: x\n\nS.").formal).toBe("x");
  expect(splitLegacyExample("Formalnie (OET): x\n\nS.").formal).toBe("x");
});

it("puste i brakujace wejscie nie wysadza rozbioru", () => {
  const pusty = { pronunciation: "", synonyms: "", formal: "", example: "" };
  expect(splitLegacyExample("")).toEqual(pusty);
  expect(splitLegacyExample(undefined)).toEqual(pusty);
  expect(splitLegacyExample(null)).toEqual(pusty);
  expect(splitLegacyExample("   \n  ")).toEqual(pusty);
});

it("rozpoznaje, czy jest co wydzielac", () => {
  expect(hasLegacyParts("Synonimy: x\n\nZdanie.")).toBe(true);
  expect(hasLegacyParts("/aɪ/\n\nZdanie.")).toBe(true);
  expect(hasLegacyParts("Samo zdanie.")).toBe(false);
});
