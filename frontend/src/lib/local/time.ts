/** Czas nauki: granica dnia i etykiety interwalow. */

/**
 * Granica dnia o 4:00, nie o polnocy - nauka po polnocy liczy sie do dnia
 * poprzedniego. Czas lokalny telefonu (nie UTC jak w backendzie): aplikacja
 * zyje na jednym urzadzeniu, wiec strefa urzadzenia jest wlasciwa.
 */
export const DAY_ROLLOVER_HOUR = 4;

export function dayStart(now: Date): Date {
  const start = new Date(now);
  start.setHours(DAY_ROLLOVER_HOUR, 0, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  return start;
}

/** Te same progi i etykiety co w backendzie - "10 min", "4 dni", "1.5 lat". */
export function humanizeInterval(ms: number): string {
  const minutes = Math.max(Math.floor(ms / 60_000), 0);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} godz.`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "1 dzien" : `${days} dni`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mies.`;
  return `${(days / 365).toFixed(1)} lat`;
}
