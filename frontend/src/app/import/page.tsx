"use client";

import Link from "next/link";

import { AppShell } from "@/components/AppShell";

/**
 * Zaslepka na czas migracji local-first (ADR 0006).
 *
 * Poprzednia wersja tego ekranu wysylala plik do backendu FastAPI - wersja
 * liczona w przegladarce (fiszki/v1, CSV/TSV, tekst; Anki pozniej) to punkt 3
 * planu migracji. Parsery do przeniesienia sa w backend/app/importers.
 */
export default function ImportPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm opacity-70">
          Import jest przenoszony do wersji dzialajacej w calosci na tym
          urzadzeniu i wroci w nastepnym kroku migracji. Obsluzy formaty:
          fiszki/v1 (wlasny), CSV/TSV i zwykly tekst, pozniej takze Anki.
        </p>
        <p className="text-sm opacity-70">
          Gotowe talie w formacie fiszki/v1 (w tym talie OET z katalogu{" "}
          <code>talie/</code>) beda wtedy wchodzic bez mapowania kolumn.
        </p>
        <Link href="/" className="inline-block text-sm underline opacity-70 hover:opacity-100">
          ← Wroc do talii
        </Link>
      </div>
    </AppShell>
  );
}
