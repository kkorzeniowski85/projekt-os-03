/*
 * Service worker: aplikacja ma dzialac bez sieci.
 *
 * Po zwrocie na local-first (ADR 0006) nie ma juz zadnego API - dane i
 * planowanie zyja w IndexedDB w przegladarce. Do pelnej pracy offline
 * wystarczy wiec zapamietac same pliki aplikacji. Poprzednia wersja tego
 * pliku celowo tego nie robila, bo wtedy fiszki mieszkaly na serwerze.
 *
 * Strategie:
 *   - nawigacje  -> siec scigana z zegarem: kto pierwszy, ten lepszy.
 *                   Swieza wersja wchodzi sama, ale telefon "online bez
 *                   transmisji" (slaby zasieg, winda, metro) nie zawiesza
 *                   startu - po chwili dostaje wersje z pamieci
 *   - /_next/static -> najpierw pamiec; te pliki maja hash w nazwie, wiec
 *                   ich tresc nigdy sie nie zmienia
 *   - reszta     -> najpierw pamiec, w tle odswiezenie
 */

const VERSION = "v5";
const SHELL = `fiszki-shell-${VERSION}`;
const ASSETS = `fiszki-assets-${VERSION}`;

//: Prefiks hostingu odczytany z wlasnego zasiegu - na GitHub Pages aplikacja
//: stoi w podkatalogu, lokalnie w korzeniu. Dzieki temu nazwa repozytorium
//: nie jest zaszyta w tym pliku.
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");

//: Ile czekamy na siec przy otwieraniu aplikacji, zanim pokazemy wersje
//: z pamieci. navigator.onLine bywa prawdziwe przy zerowej transmisji,
//: a wtedy fetch potrafi wisiec kilkadziesiat sekund. Aplikacja jest
//: lokalna - nie ma na co czekac tak dlugo.
const CZEKAJ_NA_SIEC_MS = 2500;

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

  // Slownik wbudowany (slownik/): zawsze z sieci, nigdy z pamieci. Aplikacja
  // sama porownuje odciski i trzyma tresc w IndexedDB, wiec stara kopia
  // w cache tylko opoznialaby aktualizacje o jedno otwarcie.
  if (url.pathname.startsWith(`${BASE}/slownik/`)) return;

  // Nawigacje: siec ma pierwszenstwo, zeby nowa wersja wchodzila sama.
  // Bez zasiegu - wersja z pamieci; gdy i tej nie ma, strona glowna.
  if (request.mode === "navigate") {
    // Parametry zapytania nie zmieniaja pliku strony (/nauka?talia=x to ten
    // sam dokument co /nauka/), wiec szukamy po samej sciezce.
    const zPamieci = async () =>
      (await caches.match(url.pathname)) ??
      (await caches.match(request, { ignoreSearch: true })) ??
      (await caches.match(`${BASE}/`));

    const zSieci = fetch(request).then((response) => {
      // Odpowiedz z sieci trafia do pamieci takze wtedy, gdy przyszla po
      // zegarze i uzytkownik oglada juz wersje zapamietana - nastepne
      // otwarcie bedzie mialo swiezsza.
      const copy = response.clone();
      caches.open(SHELL).then((cache) => cache.put(request, copy));
      return response;
    });

    event.respondWith(
      Promise.race([
        zSieci.catch(() => zPamieci().then((c) => c ?? Response.error())),
        new Promise((resolve) => {
          setTimeout(() => {
            // Zegar wygrywa tylko wtedy, gdy JEST co pokazac. Bez kopii
            // w pamieci czekamy na siec do skutku - pusty ekran bylby gorszy.
            zPamieci().then((c) => {
              if (c) resolve(c);
            });
          }, CZEKAJ_NA_SIEC_MS);
        }),
      ]),
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
