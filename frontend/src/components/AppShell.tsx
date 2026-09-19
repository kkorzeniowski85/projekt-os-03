"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { applyBundled } from "@/lib/local/bundled";
import { naprawPrzyklady } from "@/lib/local/repo";
import { requestPersistentStorage } from "@/lib/local/db";
import { odmien } from "@/lib/types";

/**
 * Wspolna ramka ekranow. Wersja local-first - bez logowania (ADR 0006).
 *
 * Nawigacja jest na DOLE: cztery linki tekstowe w rogu naglowka byly na
 * telefonie za ciasne, a gora ekranu jest cenniejsza niz dol.
 */
//: Raz na zaladowanie strony, nie na kazda nawigacje. Nowa wersja aplikacji
//: przychodzi przez service worker i przeladowanie - wtedy sprawdzamy znowu.
let bundledChecked = false;

export function AppShell({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Prosba o trwala pamiec - bez niej przegladarka moglaby w potrzebie
    // wyczyscic dane. Odmowa nie jest bledem; na Androidzie dla
    // zainstalowanej PWA zwykle przyznawane automatycznie.
    void requestPersistentStorage();

    // Porzadkowanie starych notatek: wymowa, synonimy i odpowiednik formalny
    // wracaja z pola "przyklad" do swoich pol. PRZED bramka sieci - to praca
    // na wlasnej bazie, bez zasiegu tez ma sie wykonac. Ekran nauki dziala
    // poprawnie takze bez niej (rozbior w locie), wiec porazka jest cicha.
    void naprawPrzyklady().catch((blad) => console.warn("naprawa przykladow:", blad));

    // Slownik wbudowany: cicha dostawa tresci z pakietu (ADR 0007). Bez sieci
    // konczy sie po cichu; glos zabiera tylko wtedy, gdy cos doszlo.
    if (bundledChecked || !navigator.onLine) return;
    bundledChecked = true;
    void applyBundled()
      .then(async (result) => {
        // Pakiet to jedyne zrodlo nowej sklejonej tresci - po dostawie
        // porzadkujemy jeszcze raz.
        if (result.status === "applied") {
          await naprawPrzyklady().catch(() => undefined);
        }
        return result;
      })
      .then((result) => {
      // navigator.onLine klamie przy braku zasiegu i portalach logowania -
      // dopiero fetch wie, ze sieci nie ma. Wtedy sprobujemy ponownie
      // przy nastepnym ekranie zamiast milczec do konca sesji.
      if (result.status === "offline") bundledChecked = false;
      if (result.status !== "applied" || result.imported + result.updated === 0) return;
      const parts: string[] = [];
      if (result.imported > 0) {
        parts.push(
          `${result.imported} ${odmien(result.imported, "nowa fiszka", "nowe fiszki", "nowych fiszek")}`,
        );
      }
      if (result.updated > 0) {
        parts.push(
          `${result.updated} ${odmien(result.updated, "uzupełniona", "uzupełnione", "uzupełnionych")}`,
        );
      }
      setNotice(`Słownik zaktualizowany: ${parts.join(" · ")}.`);
    });
  }, []);

  return (
    // flex-1, nie min-h-full: procentowa wysokosc nie ma tu odniesienia, bo
    // body ma tylko min-height. Bez tego dolna nawigacja wisi tuz pod trescia
    // zamiast przy krawedzi ekranu.
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-4 pt-5">
        {notice && <Notice text={notice} onClose={() => setNotice(null)} />}
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

/** Jedna linia nad trescia - do zamkniecia, nie do klikania. */
function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <p
      role="status"
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-good-line bg-good-bg px-3 py-2.5 text-sm text-good"
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Zamknij"
        className="-mr-1 px-1 leading-none opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </p>
  );
}

/**
 * Ekran nauki: bez nawigacji i bez naglowka. Jedyne wyjscie to strzalka
 * wstecz w samym ekranie. Nic nie moze konkurowac z trescia fiszki.
 */
export function FocusShell({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col">{children}</div>;
}

const NAV = [
  {
    href: "/",
    label: "Talie",
    icon: (
      <>
        <rect x="3" y="5" width="13" height="16" rx="2" />
        <path d="M8 2h11a2 2 0 0 1 2 2v13" />
      </>
    ),
  },
  {
    href: "/stats",
    label: "Statystyki",
    icon: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  },
  {
    href: "/import",
    label: "Import",
    icon: <path d="M12 3v13M8 12l4 4 4-4M4 21h16" />,
  },
  {
    href: "/ustawienia",
    label: "Ustawienia",
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  },
];

function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-2xl">
        {NAV.map((item) => {
          // "/" pasuje tylko dokladnie; reszta takze do podstron.
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 pb-5 pt-3 text-[11px] ${
                active ? "font-medium text-accent" : "text-ink-3"
              }`}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {item.icon}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-8 text-sm text-ink-2">
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-again-line bg-again-bg px-3 py-2 text-sm text-again"
    >
      {message}
    </p>
  );
}

/** Wspolne klasy pol formularza - jedno miejsce na wyglad kontrolek. */
export const inputClass =
  "w-full rounded-lg border border-field bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-4 focus:border-accent";

export const buttonClass =
  "rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-40";

export const secondaryButtonClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink hover:border-field";
