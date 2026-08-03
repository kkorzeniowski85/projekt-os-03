"use client";

import { useEffect } from "react";

/**
 * Rejestruje service workera - bez niego przegladarka nie uzna aplikacji za
 * instalowalna.
 *
 * Uwaga: obecny SW cache'uje tylko powloke aplikacji. Dane (talie, fiszki) nie
 * dzialaja offline - to swiadomie odlozone, patrz docs/adr/0002.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* brak SW to degradacja, nie blad krytyczny */
    });
  }, []);

  return null;
}
