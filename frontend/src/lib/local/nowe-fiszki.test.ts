/**
 * Bramka jakosci dla NOWYCH fiszek pakietu - tych, ktorych source_ref nie ma
 * w ostatnim commicie (git HEAD).
 *
 * Uruchamiana przed commitem: `npm run sprawdz-nowe`. Uzywa jej sesja w chmurze,
 * ktora przetwarza skrzynke (CLAUDE.md, sekcja "Skrzynka"), i ja, gdy dodaje
 * slowka recznie. Starego materialu nie ocenia: czesc ma placeholdery
 * i fiszki bez zdan, a ta bramka ma zatrzymac nowe bledy, nie stare.
 * Po commicie (takze w CI) nowych fiszek nie ma, wiec test przechodzi.
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

import { firstClozeLine, findPhrase } from "./phrase";

const SLOWNIK = resolve(__dirname, "../../../public/slownik");

type Notatka = {
  front: string;
  example?: string;
  pronunciation?: string;
  synonyms?: string | string[];
  register?: string;
  source_ref?: string;
};

function refyZHead(): Set<string> {
  const refy = new Set<string>();
  let lista = "";
  try {
    lista = execSync("git ls-tree --name-only HEAD -- public/slownik/", {
      cwd: resolve(__dirname, "../../.."),
      encoding: "utf8",
    });
  } catch {
    return refy; // bez gita (np. paczka bez historii) - wszystko jest "nowe"
  }
  for (const sciezka of lista.split("\n").filter((s) => s.endsWith(".json") && !s.endsWith("manifest.json"))) {
    const tresc = execSync(`git show HEAD:frontend/${sciezka}`, {
      cwd: resolve(__dirname, "../../.."),
      encoding: "utf8",
    });
    for (const n of (JSON.parse(tresc) as { notes: Notatka[] }).notes) {
      if (n.source_ref) refy.add(n.source_ref);
    }
  }
  return refy;
}

it("nowe fiszki pakietu spelniaja zasady jakosci", () => {
  const stare = refyZHead();
  const bledy: string[] = [];
  let nowych = 0;

  for (const plik of readdirSync(SLOWNIK).filter((f) => f.endsWith(".json") && f !== "manifest.json")) {
    const dane = JSON.parse(readFileSync(join(SLOWNIK, plik), "utf8")) as { notes: Notatka[] };
    for (const n of dane.notes) {
      if (n.source_ref && stare.has(n.source_ref)) continue;
      nowych += 1;
      const gdzie = `${plik}: ${n.front}`;
      const zdania = (n.example ?? "").split("\n").filter((l) => l.trim());
      if (zdania.length < 2) bledy.push(`${gdzie} - za malo zdan (${zdania.length}, wymagane 3)`);
      for (const z of zdania) if (!findPhrase(z, n.front)) bledy.push(`${gdzie} - zdanie bez zwrotu: ${z}`);
      if (zdania.length && !firstClozeLine(n.example ?? "", n.front)) bledy.push(`${gdzie} - brak luki`);
      const syn = Array.isArray(n.synonyms) ? n.synonyms.join(" / ") : (n.synonyms ?? "");
      if (syn && findPhrase(syn, n.front)) bledy.push(`${gdzie} - synonimy zdradzaja haslo: ${syn}`);
      if (!n.pronunciation?.startsWith("/")) bledy.push(`${gdzie} - brak wymowy IPA`);
      if (!n.register) bledy.push(`${gdzie} - brak pola register`);
      if (!n.source_ref) bledy.push(`${gdzie} - brak source_ref`);
      if (/\[[^\]]*\]/.test(`${n.front}\n${n.example ?? ""}`)) bledy.push(`${gdzie} - placeholder w nawiasie kwadratowym`);
    }
  }

  if (nowych) console.log(`sprawdzono nowych fiszek: ${nowych}`);
  expect(bledy).toEqual([]);
});
