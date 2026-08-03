# 0006 — Local-first: wszystko w telefonie, bez synchronizacji

Data: 2026-08-03. Status: obowiązuje. **Unieważnia centralne założenie ADR 0002.**

## Kontekst

Użytkownik zdecydował: aplikacja ma działać głównie na telefonie (Galaxy S23,
Android), bez synchronizacji między urządzeniami i bez utrzymywania serwera.
Wersja serwerowa (FastAPI + PostgreSQL) nigdy nie została uruchomiona z bazą —
Docker i PostgreSQL nie dały się zainstalować na Windowsie użytkownika, a koszt
i obsługa VPS-a nie są uzasadnione dla jednego urządzenia.

## Decyzja

Aplikacja staje się **local-first PWA**: całość danych i logiki w przeglądarce
telefonu, hosting wyłącznie statyczny (darmowy), działa offline.

- **Dane**: IndexedDB (przez bibliotekę `idb`). Rekordy trzymają daty jako ISO
  string — indeksy sortują się poprawnie, a eksport do JSON nie wymaga
  konwersji. Jedyne miejsce zamiany na `Date` to granica z biblioteką FSRS.
- **Planowanie**: `ts-fsrs` (FSRS-6 — ta sama generacja algorytmu co `py-fsrs`
  w backendzie). Czysty TypeScript, bez WASM.
- **Fuzzing wraca**: przesłanka wyłączenia (deterministyczne odtwarzanie stanu
  z logu na wielu urządzeniach, ADR 0002) przestała istnieć. Rozrzucanie
  interwałów zapobiega zlepianiu się powtórek w jeden dzień. Podgląd interwałów
  na przyciskach pozostaje wiarygodny, bo fuzz w ts-fsrs jest siany stanem
  karty — podgląd i faktyczna ocena dają ten sam wynik (pilnuje tego test).
- **Granica dnia nauki: 4:00 czasu lokalnego** (nie UTC jak w backendzie).
  Aplikacja żyje na jednym urządzeniu, więc strefa telefonu jest właściwa.
- **Log powtórek pozostaje append-only** i denormalizuje `deckId` oraz
  `itemKind`. Dzięki temu skasowanie notatki nie dziurawi statystyk — historia
  pracy przeżywa swoje karty, a rozbicie na kategorie materiału działa też dla
  materiału usuniętego.
- **`durationMs` w logu pozostaje wymagane** (dziedzictwo ADR 0005 — bez tego
  optymalizacja parametrów na własnej historii byłaby na zawsze zamknięta).
- **Kopia zapasowa do pliku to funkcja pierwszej klasy**, nie dodatek: dane
  istnieją wyłącznie w pamięci przeglądarki jednego telefonu. Eksport/import
  pliku jest też jedynym sposobem przeniesienia danych na inne urządzenie.
- Po instalacji aplikacja prosi o `navigator.storage.persist()` — na Androidzie
  dla zainstalowanej PWA zwykle przyznawane bez pytania.

## Co z backendem

Zostaje w repozytorium do czasu przeniesienia importu i statystyk — to tam jest
przetestowana logika (parsery, definicje metryk) i z niej są portowane kolejne
warstwy. Po zakończeniu migracji decyzja o usunięciu. Backendowy test
`ENABLE_FUZZING is False` pilnuje świata, który przestaje być używany — nie
przenosić go do wersji lokalnej.

## Konsekwencje

- Odpadają: konta, kod zaproszenia, rodzina, JWT — w tej wersji nie istnieją.
- Dane są tak trwałe jak profil Chrome na telefonie. Wyczyszczenie danych
  aplikacji/przeglądarki bez świeżej kopii = utrata historii nauki.
- Anki `.apkg` wymaga SQLite w przeglądarce (sql.js/WASM, doładowywany tylko
  przy wyborze takiego pliku) — wchodzi później niż formaty tekstowe.
