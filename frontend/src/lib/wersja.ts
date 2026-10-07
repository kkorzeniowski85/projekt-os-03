/**
 * Czy worker, ktory przejal strone, pochodzi z NOWSZEGO wydania niz ona.
 *
 * Identyfikator wydania to numer przebiegu w GitHub Actions (rosnie z kazdym
 * wdrozeniem), wiec porownujemy liczbowo. Sama roznosc nie wystarczy: przez
 * kilka minut po wdrozeniu CDN potrafi podac nowa strone i stary sw.js -
 * worker ze starszego wydania nie ma wtedy prawa wolac o odswiezenie.
 * Identyfikatory nieliczbowe (lokalnie "dev") porownujemy po prostu
 * na roznosc.
 */
export function nowszaWersja(worker: string, strona: string): boolean {
  const w = Number(worker);
  const s = Number(strona);
  if (worker.trim() !== "" && strona.trim() !== "" && Number.isFinite(w) && Number.isFinite(s)) {
    return w > s;
  }
  return worker !== strona;
}
