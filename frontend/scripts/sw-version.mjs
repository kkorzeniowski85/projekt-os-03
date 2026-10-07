/**
 * Stempluje out/sw.js identyfikatorem wydania (krok postbuild).
 *
 * Nowy plik workera = nowy worker w przegladarce = swieza pamiec podreczna
 * i skasowanie starej. Bez tego kolejne wdrozenia zostawialy ten sam
 * worker, a stare pliki z hashem zbieraly sie w pamieci bez konca.
 *
 * Identyfikator jest ten sam, ktory aplikacja dostaje w NEXT_PUBLIC_BUILD_ID
 * - dzieki temu strona rozpoznaje, ze przejal ja worker z nowszego wydania,
 * i pokazuje pasek "Jest nowa wersja". Lokalnie oba zostaja "dev".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const plik = resolve(process.cwd(), "out/sw.js");
const wersja = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const src = readFileSync(plik, "utf8");
const wzor = /const VERSION = "[^"]*";/;
if (!wzor.test(src)) {
  throw new Error("out/sw.js: brak linii `const VERSION = \"...\";` - nie ma czego ostemplowac");
}
writeFileSync(plik, src.replace(wzor, `const VERSION = ${JSON.stringify(wersja)};`));
console.log(`sw.js: VERSION = ${wersja}`);
