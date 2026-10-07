/**
 * Pole "uzycie" (Register): rejestr i czestosc zwrotu.
 *
 * Test na pakiecie pilnuje, zeby kazda nowa fiszka dostala etykiete z tego
 * samego slownika - inaczej po kilku dostawach mielibysmy "formal",
 * "formalny" i "oficjalne" obok siebie.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { FIELD_REGISTER, KNOWN_FIELDS } from "./content";
import { parse } from "./import/canonical";

const SLOWNIK = resolve(__dirname, "../../../public/slownik");
const ETYKIETA =
  /^(potoczne|codzienne|formalne|fachowe|żargon szpitalny|skrót) · (bardzo częste|częste|rzadkie) — \S.*$/;

describe("pole uzycia", () => {
  it("jest dopisane NA KONCU listy pol", () => {
    // Wstawka w srodku przetasowalaby klucze w kazdej istniejacej notatce
    // (patrz komentarz przy KNOWN_FIELDS).
    expect(KNOWN_FIELDS).toEqual([
      "Front",
      "Back",
      "Example",
      "Pronunciation",
      "Synonyms",
      "Formal",
      FIELD_REGISTER,
    ]);
  });

  it("fiszki/v1 czyta klucz register", () => {
    const plik = {
      format: "fiszki/v1",
      notes: [{ front: "to liaise", back: "współpracować", register: "formalne · częste — listy" }],
    };
    const wynik = parse(new TextEncoder().encode(JSON.stringify(plik)));
    expect(wynik.rows[0].values[FIELD_REGISTER]).toBe("formalne · częste — listy");
    expect(wynik.suggestedMapping[FIELD_REGISTER]).toBe(FIELD_REGISTER);
  });

  it("kazda fiszka w pakiecie ma uzycie ze wspolnego slownika etykiet", () => {
    const zle: string[] = [];
    for (const plik of readdirSync(SLOWNIK).filter((f) => f.endsWith(".json") && f !== "manifest.json")) {
      const dane = JSON.parse(readFileSync(join(SLOWNIK, plik), "utf8")) as {
        notes: { front: string; register?: string }[];
      };
      for (const n of dane.notes) {
        if (!n.register || !ETYKIETA.test(n.register)) zle.push(`${plik}: ${n.front} -> ${n.register}`);
      }
    }
    expect(zle).toEqual([]);
  });
});
