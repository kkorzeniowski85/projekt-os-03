import type { NextConfig } from "next";

/**
 * Eksport w pelni statyczny - aplikacja nie ma juz serwera (ADR 0006).
 * Wynikiem `npm run build` jest katalog `out/` z plikami do wrzucenia na
 * dowolny darmowy hosting statyczny.
 *
 * Konsekwencja, ktora wymusila zmiane adresow: trasy dynamiczne wymagaja
 * znajomosci wszystkich sciezek w chwili budowania, a identyfikatory talii
 * powstaja dopiero w przegladarce uzytkownika. Stad `/nauka?talia=<id>`
 * zamiast `/decks/<id>/study`.
 */
const nextConfig: NextConfig = {
  output: "export",

  // Kazda strona jako katalog z index.html - dziala na hostingu bez zadnej
  // konfiguracji przepisywania adresow (GitHub Pages, Cloudflare, Netlify).
  trailingSlash: true,

  // Brak serwera = brak optymalizacji obrazow w locie.
  images: { unoptimized: true },
};

export default nextConfig;
