"use client";

import { useEffect } from "react";

/**
 * Rejestruje service workera - bez niego nie ma ani instalacji na ekranie
 * glownym, ani pracy offline.
 *
 * Sciezka musi uwzgledniac prefiks hostingu: na GitHub Pages aplikacja stoi
 * w podkatalogu, wiec /sw.js wskazywaloby na korzen cudzej domeny.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {
      /* brak SW to degradacja (dziala online), nie blad krytyczny */
    });
  }, []);

  return null;
}
