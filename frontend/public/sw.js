/*
 * Minimalny service worker: cache'uje wylacznie powloke aplikacji.
 *
 * Czego tu CELOWO nie ma: cache'owania odpowiedzi z /api. Fiszki i stan
 * powtorek nie dzialaja offline - pokazanie nieaktualnej kolejki i przyjecie
 * ocen, ktorych nie ma jak wyslac, bylo by gorsze niz uczciwy blad sieci.
 * Offline wchodzi razem z modelem synchronizacji (docs/adr/0002).
 *
 * Rola tego pliku na dzis: spelnic warunek instalowalnosci PWA.
 */

const CACHE = "fiszki-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["/manifest.webmanifest", "/icon-192.png"])),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Cudze originy (w tym backend API) zostawiamy sieci bez posrednika.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
