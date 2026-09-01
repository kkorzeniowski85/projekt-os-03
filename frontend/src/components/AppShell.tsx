"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { requestPersistentStorage } from "@/lib/local/db";

/**
 * Wspolna ramka ekranow. Wersja local-first - bez logowania (ADR 0006).
 *
 * Nawigacja jest na DOLE: cztery linki tekstowe w rogu naglowka byly na
 * telefonie za ciasne, a gora ekranu jest cenniejsza niz dol.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Prosba o trwala pamiec - bez niej przegladarka moglaby w potrzebie
    // wyczyscic dane. Odmowa nie jest bledem; na Androidzie dla
    // zainstalowanej PWA zwykle przyznawane automatycznie.
    void requestPersistentStorage();
  }, []);

  return (
    // flex-1, nie min-h-full: procentowa wysokosc nie ma tu odniesienia, bo
    // body ma tylko min-height. Bez tego dolna nawigacja wisi tuz pod trescia
    // zamiast przy krawedzi ekranu.
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-4 pt-5">{children}</main>
      <BottomNav />
    </div>
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
