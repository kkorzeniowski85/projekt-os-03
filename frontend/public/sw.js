/*
 * Service worker: aplikacja ma dzialac bez sieci.
 *
 * Po zwrocie na local-first (ADR 0006) nie ma juz zadnego API - dane i
 * planowanie zyja w IndexedDB w przegladarce. Do pelnej pracy offline
 * wystarczy wiec zapamietac same pliki aplikacji. Poprzednia wersja tego
 * pliku celowo tego nie robila, bo wtedy fiszki mieszkaly na serwerze.
 *
 * Strategie:
 *   - nawigacje  -> najpierw siec, przy braku zasiegu wersja z pamieci
 *                   (swieza wersja po wdrozeniu, ale offline zawsze dziala)
 *   - /_next/static -> najpierw pamiec; te pliki maja hash w nazwie, wiec
 *                   ich tresc nigdy sie nie zmienia
 *   - reszta     -> najpierw pamiec, w tle odswiezenie
 */

const VERSION = "v2";
const SHELL = `fiszki-shell-${VERSION}`;
const ASSETS = `fiszki-assets-${VERSION}`;

//: Prefiks hostingu odczytany z wlasnego zasiegu - na GitHub Pages aplikacja
//: stoi w podkatalogu, lokalnie w korzeniu. Dzieki temu nazwa repozytorium
//: nie jest zaszyta w tym pliku.
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");

//: Strony aplikacji - wszystkie musza byc dostepne offline.
const ROUTES = ["/", "/nauka/", "/fiszki/", "/import/", "/stats/", "/ustawienia/"].map(
  (path) => `${BASE}${path}`,
);
const EXTRAS = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"].map(
  (path) => `${BASE}${path}`,
);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // Pojedynczy brak nie moze wysadzic instalacji - stad addAll po jednym.
      Promise.all(
        [...ROUTES, ...EXTRAS].map((path) =>
          cache.add(path).catch(() => undefined),
        ),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== SHELL && key !== ASSETS).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nawigacje: siec ma pierwszenstwo, zeby nowa wersja wchodzila sama.
  // Bez zasiegu - wersja z pamieci; gdy i tej nie ma, strona glowna.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          // Parametry zapytania nie zmieniaja pliku strony (/nauka?talia=x
          // to ten sam dokument co /nauka/), wiec szukamy po samej sciezce.
          const cached =
            (await caches.match(url.pathname)) ??
            (await caches.match(request, { ignoreSearch: true })) ??
            (await caches.match(`${BASE}/`));
          return cached ?? Response.error();
        }),
    );
    return;
  }

  // Pliki z hashem w nazwie sa niezmienne - pamiec ma pierwszenstwo.
  const immutable = url.pathname.startsWith(`${BASE}/_next/static/`);
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached && immutable) return cached;
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSETS).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
