"use client";

import { useEffect, useState } from "react";

import { nowszaWersja } from "@/lib/wersja";

//: Identyfikator wydania tej strony - ten sam trafia do sw.js przy budowaniu.
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/**
 * Rejestruje service workera - bez niego nie ma ani instalacji na ekranie
 * glownym, ani pracy offline - i pokazuje pasek, gdy przejal strone worker
 * z nowszego wydania.
 *
 * Sciezka musi uwzgledniac prefiks hostingu: na GitHub Pages aplikacja stoi
 * w podkatalogu, wiec /sw.js wskazywaloby na korzen cudzej domeny.
 */
export function RegisterServiceWorker() {
  //: Wersja workera, ktory przejal strone - tylko gdy inna niz wersja strony.
  //: Przy slabym zasiegu worker podaje strone z pamieci, czyli o jedno
  //: wydanie do tylu; zamiast kazac otwierac aplikacje drugi raz, mowimy
  //: wprost, ze jest nowsza.
  const [nowaWersja, setNowaWersja] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; wersja?: string } | null;
      if (data?.type !== "wersja" || !data.wersja) return;
      setNowaWersja(nowszaWersja(data.wersja, BUILD) ? data.wersja : null);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    navigator.serviceWorker
      .register(`${base}/sw.js`, { scope: `${base}/` })
      .then(() => {
        // Worker mogl przejac strone, zanim zalozylismy nasluch - dopytujemy.
        navigator.serviceWorker.controller?.postMessage({ type: "wersja?" });
      })
      .catch(() => {
        /* brak SW to degradacja (dziala online), nie blad krytyczny */
      });

    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  if (!nowaWersja) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b border-line bg-surface px-4 py-2.5 text-[13px] text-ink-2 shadow-sm"
    >
      <span>Jest nowa wersja aplikacji.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="font-medium text-accent hover:underline"
      >
        Odśwież
      </button>
    </div>
  );
}
