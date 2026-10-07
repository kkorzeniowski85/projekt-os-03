import { expect, it } from "vitest";

import { nowszaWersja } from "./wersja";

it("numer przebiegu: tylko wyzszy numer workera oznacza nowsze wydanie", () => {
  expect(nowszaWersja("18000000002", "18000000001")).toBe(true);
  expect(nowszaWersja("18000000001", "18000000001")).toBe(false);
  // CDN podal stary sw.js do nowej strony - bez paska.
  expect(nowszaWersja("18000000000", "18000000001")).toBe(false);
});

it("identyfikatory nieliczbowe: pasek przy kazdej roznicy, nigdy przy rownosci", () => {
  expect(nowszaWersja("dev", "dev")).toBe(false);
  expect(nowszaWersja("abc1234", "def5678")).toBe(true);
});
