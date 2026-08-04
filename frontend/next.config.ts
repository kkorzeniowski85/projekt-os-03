import type { NextConfig } from "next";

/**
 * Eksport w pelni statyczny - aplikacja nie ma juz serwera (ADR 0006).
 * Wynikiem `npm run build` jest katalog `out/` do wrzucenia na dowolny
 * darmowy hosting statyczny.
 *
 * Konsekwencja, ktora wymusila zmiane adresow: trasy dynamiczne wymagaja
 * znajomosci wszystkich sciezek w chwili budowania, a identyfikatory talii
 * powstaja dopiero w przegladarce. Stad `/nauka?talia=<id>`.
 *
 * BASE_PATH: GitHub Pages serwuje projekt z podkatalogu
 * (kkorzeniowski85.github.io/projekt-os-03), wiec build dla Pages musi znac
 * ten prefiks - inaczej wszystkie odwolania do plikow trafiaja w pustke.
 * Lokalnie zmienna jest pusta i aplikacja dziala z korzenia.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",

  // Kazda strona jako katalog z index.html - dziala na hostingu bez zadnej
  // konfiguracji przepisywania adresow.
  trailingSlash: true,

  // Brak serwera = brak optymalizacji obrazow w locie.
  images: { unoptimized: true },

  ...(BASE_PATH ? { basePath: BASE_PATH, assetPrefix: BASE_PATH } : {}),
};

export default nextConfig;
