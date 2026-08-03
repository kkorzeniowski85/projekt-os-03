"use client";

import Link from "next/link";

import { AppShell } from "@/components/AppShell";

/**
 * Zaslepka na czas migracji local-first (ADR 0006).
 *
 * Poprzednia wersja liczyla statystyki w PostgreSQL - wersja liczona
 * lokalnie z logu powtorek to punkt 4 planu migracji. Definicje metryk
 * do przeniesienia sa w backend/app/services/stats.py i ADR 0005.
 */
export default function StatsPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Statystyki</h1>
        <p className="text-sm opacity-70">
          Statystyki sa przenoszone do wersji liczonej w calosci na tym
          urzadzeniu i wroca w kolejnym kroku migracji: skutecznosc z podzialem
          na kategorie materialu (slowa / frazy / wyrazenia / zdania),
          aktywnosc, prognoza obciazenia i material do przeformulowania.
        </p>
        <p className="text-sm opacity-70">
          Log powtorek jest juz zbierany lokalnie od pierwszej oceny - historia
          nie przepada i statystyki obejma ja wstecz.
        </p>
        <Link href="/" className="inline-block text-sm underline opacity-70 hover:opacity-100">
          ← Wroc do talii
        </Link>
      </div>
    </AppShell>
  );
}
