/** Porownanie wpisanej odpowiedzi ze wzorcem. */

import { expect, it } from "vitest";

import { compareAnswer } from "./answer";

it("pomija roznice zapisu: wielkosc liter, interpunkcja, spacje", () => {
  expect(compareAnswer("To rule out.", "to rule out").exact).toBe(true);
  expect(compareAnswer("  to   rule out  ", "to rule out").exact).toBe(true);
});

it("brytyjska literowka to 'prawie', nie 'dobrze'", () => {
  const wynik = compareAnswer("diarrhea", "diarrhoea");
  expect(wynik.exact).toBe(false);
  expect(wynik.close).toBe(true);
});

it("inna odpowiedz to nie literowka", () => {
  const wynik = compareAnswer("to exclude", "to rule out");
  expect(wynik.exact).toBe(false);
  expect(wynik.close).toBe(false);
});

it("wskazuje slowa spoza wzorca", () => {
  const wynik = compareAnswer("to rule off", "to rule out");
  const bledne = wynik.parts.filter((p) => !p.ok).map((p) => p.text);
  expect(bledne).toEqual(["off"]);
});

it("pusta odpowiedz nie jest 'prawie'", () => {
  expect(compareAnswer("", "to rule out")).toMatchObject({ exact: false, close: false });
});
