"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { requestPersistentStorage } from "@/lib/local/db";

/** Wspolna ramka ekranow. Wersja local-first - bez logowania (ADR 0006). */
export function AppShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Prosba o trwala pamiec - bez niej przegladarka moglaby w potrzebie
    // wyczyscic dane. Odmowa nie jest bledem; na Androidzie dla
    // zainstalowanej PWA zwykle przyznawane automatycznie.
    void requestPersistentStorage();
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-black/10 dark:border-white/15">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <nav className="flex items-center gap-4">
            <Link href="/" className="font-semibold tracking-tight">
              Fiszki
            </Link>
            <Link href="/stats" className="text-sm opacity-70 hover:opacity-100">
              Statystyki
            </Link>
            <Link href="/import" className="text-sm opacity-70 hover:opacity-100">
              Import
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

export function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-8 text-sm opacity-70">
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
    >
      {message}
    </p>
  );
}
