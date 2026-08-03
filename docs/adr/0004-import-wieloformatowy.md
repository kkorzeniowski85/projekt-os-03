# ADR 0004 — Import wieloformatowy z normalizacją do jednego formatu

**Status:** zaakceptowany, zaimplementowany
**Data:** 2026-08-03

## Wymaganie

Import fiszek z różnych formatów, sprowadzanych w aplikacji do jednego formatu
własnego. Główne talie mają być dostarczane z zewnątrz w gotowej postaci.

## Decyzja: import jest dwufazowy

Żaden zewnętrzny format nie mówi wprost, która kolumna jest przodem, która
tyłem, a która tagiem. Wrzucenie pliku prosto do bazy oznaczałoby zgadywanie
i sprzątanie po pomyłce.

1. **Analiza** (`POST /api/import/analyze`) — parsuje źródło, wykrywa kolumny,
   proponuje mapowanie, liczy duplikaty, zwraca podgląd. **Nic nie zapisuje do
   talii.**
2. **Zatwierdzenie** (`POST /api/import/{job}/commit`) — stosuje poprawione
   przez użytkownika mapowanie i tworzy notatki.

Między fazami sparsowane wiersze leżą w `import_jobs.items` (JSONB), więc zmiana
mapowania nie wymaga ponownego wysyłania pliku. `POST /api/import/{job}/preview`
pokazuje efekt zmiany mapowania na żywo.

## Architektura

Każdy format sprowadzamy do tej samej postaci pośredniej: lista wierszy plus
lista wykrytych kolumn. Dopiero mapowanie zamienia to na notatki.

```
plik → importer → ParseResult(columns, rows) → mapowanie → notatki → baza
```

Dodanie nowego źródła to jeden moduł z funkcją `parse(data, options)` plus wpis
w `FORMATS` — nie kolejna ścieżka zapisu do bazy.

Obsługiwane dziś: **fiszki/v1** (format własny), **Anki** `.apkg`/`.colpkg`,
**CSV/TSV**, **zwykły tekst**.

## Format własny — `fiszki/v1`

Specyfikacja: [docs/format-fiszki-v1.md](../format-fiszki-v1.md).

Zaprojektowany tak, żeby dało się go dyktować i generować bez narzędzi: płaski
JSON, dwa pola wymagane, reszta opcjonalna. Import z tego formatu nie wymaga
mapowania kolumn.

## Anki — co przenosimy, a czego nie

`.apkg` to ZIP z bazą SQLite. Obsługujemy trzy warianty składowania:
`collection.anki2` i `.anki21` (schemat 11, metadane jako JSON w tabeli `col`)
oraz `.anki21b` (schemat 18, zstd, metadane w tabelach `notetypes`/`fields`/`decks`).

**Nie przenosimy stanu powtórek.** Anki liczy je algorytmem SM-2. Przepisanie
interwałów SM-2 do pól FSRS udawałoby wiedzę, której FSRS nie potwierdził —
karty startują jako nowe, a import mówi o tym wprost w ostrzeżeniu.

**Nie przenosimy mediów.** Obrazki i audio wymagają warstwy plików, której
jeszcze nie ma. Fiszki z mediami wchodzą jako sam tekst, z ostrzeżeniem ile ich
było.

## Wykrywanie nagłówka w CSV — świadomy wybór asymetrii

Przy pliku `kot;cat / pies;dog` nie da się rozstrzygnąć, czy pierwszy wiersz to
nagłówek, czy już dane. Pomyłka w jedną stronę daje źle nazwaną kolumnę, w drugą
— **kasuje pierwszą fiszkę bez śladu**.

Rozważałem `csv.Sniffer().has_header()`. Odrzucony: głosuje po długości komórek
i dla powyższego pliku uznaje nagłówek tylko dlatego, że „kot" jest o znak
krótsze od „pies". Sprawdzone w teście.

Decyzja: nagłówek uznajemy **tylko przy twardym dowodzie** — gdy któraś komórka
jest rozpoznawalną nazwą kolumny („front", „przód", „definition", …). Przy
wątpliwości wygrywa „to są dane": źle nazwana kolumna jest widoczna w podglądzie
i do poprawienia jednym przełącznikiem, a brakująca fiszka jest niewidoczna —
nikt jej nie szuka, bo nie wie, że istniała.

Decyzja jest zawsze raportowana w ostrzeżeniach, a interfejs pozwala ją
nadpisać (`has_header`).

## Deduplikacja

Kolumna `notes.content_hash` — sha256 znormalizowanej treści (`Front` + `Back`,
bez wielkości liter i białych znaków). Ta sama fiszka wyeksportowana raz z Anki,
raz do CSV daje ten sam hash. `Example` nie wchodzi do odcisku: dopisanie zdania
przykładowego nie czyni fiszki nową.

Domyślnie import pomija pozycje już obecne w kolekcji, ale faza analizy pokazuje
liczby przed decyzją (ile w pliku, ile unikalnych, ile powtórzeń wewnątrz pliku,
ile już mam).

## Świadomie odłożone

- **Podział na talie ze źródła.** `.apkg` może zawierać wiele talii; nazwy są
  odczytywane i pokazywane, ale cały import trafia do jednej wybranej talii.
- **Media.** Patrz wyżej.
- **Import w tle.** Wszystko idzie synchronicznie. Przy 20 tys. fiszek to
  kilkanaście sekund oczekiwania — do przerobienia na zadanie w tle, gdy zacznie
  przeszkadzać.
