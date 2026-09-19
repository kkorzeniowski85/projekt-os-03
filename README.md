# Fiszki

Aplikacja do fiszek z powtórkami rozłożonymi w czasie (FSRS). Monorepo:

```
backend/    FastAPI + SQLAlchemy + Alembic + py-fsrs
frontend/   Next.js (App Router) jako PWA
docs/adr/   decyzje architektoniczne
```

## 📱 Aplikacja działa: **[kkorzeniowski85.github.io/projekt-os-03](https://kkorzeniowski85.github.io/projekt-os-03/)**

Otwórz ten adres w Chrome na telefonie → menu ⋮ → **„Dodaj do ekranu głównego"**.
Aplikacja instaluje się jak zwykła, działa bez zasięgu, a nowe wersje wchodzą
same po każdym wdrożeniu.

Stan: **wersja local-first gotowa** ([ADR 0006](docs/adr/0006-local-first-bez-synchronizacji.md))
— całość działa w przeglądarce urządzenia: bez serwera, bez kont, bez
synchronizacji. Talie, nauka, import (fiszki/v1, CSV/TSV, zwykły tekst),
statystyki i kopia zapasowa (IndexedDB + ts-fsrs, FSRS-6). Backend FastAPI
pozostaje w repozytorium jako źródło portowanej logiki — nie wymaga
uruchamiania i nie jest częścią działającej aplikacji.

### Słownik — baza główna

Aplikacja ma jedną nienaruszalną bazę: **Słownik**. Istnieje od pierwszego
otwarcia, nie da się go usunąć ani „scalić w nicość" — kasować można wyłącznie
pojedyncze fiszki. Import trafia do niego domyślnie: wgrany plik **rozpływa się
w bazie** zamiast tworzyć osobną grupę (nazwa talii z pliku jest tylko
podpowiedzią przy świadomym wyborze „+ osobna talia"). Istniejące talie można
wchłonąć do Słownika przez łączenie — z pełną historią nauki.

### Słownik wbudowany — słówka przychodzą razem z aplikacją

Treść Słownika jedzie z aplikacją jak każdy inny plik: katalog
`frontend/public/slownik/` zawiera pliki `fiszki/v1`, a `manifest.json`
(generowany automatycznie przed `build` i `dev`) — ich odciski. Po otwarciu
aplikacji z dostępem do sieci telefon pobiera manifest, porównuje odciski z tym,
co już ma, i **dowozi różnicę** trybem „Uzupełnij". Ten sam przebieg uruchamia
przycisk **Aktualizuj słownik** w Ustawieniach.

Zasady, których pilnuje kod (i testy):

- **stan powtórek nietknięty** — to dostawa treści, nie synchronizacja; postęp
  nauki nadal zostaje na urządzeniu (ADR 0006)
- poprawka tłumaczenia w repozytorium trafia w **tę samą** fiszkę (po
  `source_ref`), nie tworzy drugiej obok
- fiszki poprawionej ręcznie („Edytuj") pakiet **nie nadpisuje** — dopisuje
  tylko to, czego jej brakuje
- fiszka skasowana ręcznie **nie wraca**

Nowe słówka dodaje się więc jednym ruchem: plik do `frontend/public/slownik/`,
commit, push — każde urządzenie dostanie je przy następnym otwarciu.
Szczegóły: [ADR 0007](docs/adr/0007-slownik-wbudowany.md).

### Dodawanie z telefonu

> **Czat Claude nie zna formatu tej aplikacji** — to osobne środowisko,
> bez dostępu do repozytorium i bez pamięci o projekcie. Na ekranie **Import**
> jest przycisk **„Skopiuj instrukcję dla Claude'a"**: wklej ją w rozmowie
> razem ze zdjęciem lub listą słówek, a wynik wróci gotowy do importu.
> Instrukcja jest wbudowana w aplikację, więc działa też bez zasięgu.

Trzy drogi, od najszybszej:

- **Udostępnij** — w dowolnej aplikacji (np. Claude po wygenerowaniu fiszek)
  wybierz *Udostępnij → Fiszki*: treść ląduje od razu w ekranie Import,
  przeanalizowana, z celem ustawionym na Słownik. Wymaga zainstalowanej
  aplikacji (Android/Chrome); przy większych partiach (setki fiszek) użyj
  wklejenia. Nowa opcja pojawia się w menu po ponownym otwarciu aplikacji.
- **+ Dodaj fiszkę** na liście talii — formularz Słownika, dla pojedynczych
  słówek w biegu.
- **Import → wklej treść** — dowolna ilość, dowolny format (fiszki/v1,
  CSV/TSV, tekst `słowo - tłumaczenie`).

### Nauka z wielu talii

Na liście talii można **zaznaczyć**, z których chce się materiał — albo nie
zaznaczać nic i uczyć się ze wszystkiego. Karty przeplatają się między taliami
(nie idą blokami), a **dzienne limity zostają przy swoich taliach**, więc jedna
nie zjada przydziału nowych kart innej.

Zaznaczone talie można też **trwale połączyć** w jedną. Stan powtórek każdej
karty i cała historia nauki przechodzą razem z materiałem. Operacja jest
nieodwracalna inaczej niż z kopii zapasowej — duplikaty treści są zliczane,
ale nigdy nie usuwane automatycznie.

> **Dane żyją tylko w tej przeglądarce.** Zanim wejdzie prawdziwa nauka, zrób
> kopię (Ustawienia → Pobierz kopię) i trzymaj ją poza urządzeniem.

---

## Uruchomienie lokalne

Aplikacja nie ma serwera — do pracy wystarczy `frontend/`:

```bash
cd frontend && npm install && npm run dev
```

Aplikacja: <http://localhost:3000>. `npm test` uruchamia testy warstwy lokalnej
(IndexedDB w pamięci, bez przeglądarki), `npm run build` buduje katalog `out/`,
który GitHub Actions publikuje na Pages po każdym pushu do `main`.

Katalog `backend/` (FastAPI) pozostaje wyłącznie jako źródło portowanej logiki
i archiwum decyzji — nie jest uruchamiany i nie jest częścią aplikacji.

## Co działa

**Nauka** — planowanie FSRS-6 (`ts-fsrs`) z fuzzingiem; podgląd interwałów na
przyciskach ocen zgodny z faktyczną oceną; skróty (spacja / 1–4); nauka
z jednej, wybranych albo wszystkich talii z osobnymi limitami dziennymi;
granica dnia o 4:00 czasu lokalnego.

**Słownik** — baza główna, której nie da się usunąć; import trafia do niej
domyślnie; talie można w nią wchłonąć razem z historią nauki; treść dojeżdża
z pakietem wbudowanym ([ADR 0007](docs/adr/0007-slownik-wbudowany.md)).

**Import** — `fiszki/v1`, CSV/TSV, zwykły tekst; dwufazowy (analiza
i mapowanie → zapis); deduplikacja po odcisku treści; tryb „Uzupełnij"
dopisujący przykłady, tagi i kategorię do istniejących fiszek — także po
`source_ref`, gdy zmieniło się tłumaczenie — bez ruszania stanu powtórek;
udostępnianie z innych aplikacji (Android).

**Fiszka** — przód, tył, zdanie przykładowe oraz adnotacje: wymowa, synonimy
i odpowiednik formalny (OET). Z synonimów powstaje opcjonalna karta
**„opis → termin"**: pytaniem jest parafraza, odpowiedzią uczony termin —
włączana przyciskiem w Ustawieniach, nie automatycznie.

**Statystyki** — rzeczywista skuteczność z podziałem na materiał świeży
i utrwalony, rozbicie na kategorie (słowo / fraza / wyrażenie / zdanie) i tagi,
pijawki, prognoza obciążenia, mapa dni nauki, tempo pod datę egzaminu.

**Offline** — service worker trzyma całą aplikację, dane żyją w IndexedDB.
Kopia zapasowa do pliku i przywracanie „wszystko albo nic".

## Czego świadomie nie ma

Synchronizacji postępu między urządzeniami ([ADR 0006](docs/adr/0006-local-first-bez-synchronizacji.md))
· konta i logowania · importu Anki `.apkg` (był w wersji serwerowej) · mediów
w fiszkach · optymalizacji parametrów FSRS na własnej historii · natywnych
aplikacji mobilnych.

## Dokumentacja

- [Format `fiszki/v1`](docs/format-fiszki-v1.md) — specyfikacja formatu;
  [jak tworzyć plik](docs/jak-tworzyc-fiszki.md) — poradnik dla Claude'a
- [0001 — Stack i struktura](docs/adr/0001-stack-i-struktura.md)
- [0002 — Synchronizacja i konflikty](docs/adr/0002-synchronizacja-i-konflikty.md)
  — historyczny, unieważniony przez 0006
- [0003 — Znane uproszczenia](docs/adr/0003-znane-uproszczenia.md)
- [0004 — Import wieloformatowy](docs/adr/0004-import-wieloformatowy.md)
- [0005 — Statystyki i decyzje o powtórkach](docs/adr/0005-statystyki-i-decyzje.md)
- [0006 — Local-first bez synchronizacji](docs/adr/0006-local-first-bez-synchronizacji.md)
  — **obowiązujący kierunek**
- [0007 — Słownik wbudowany](docs/adr/0007-slownik-wbudowany.md) — treść jedzie
  z aplikacją, postęp zostaje w telefonie
- [0008 — Pola adnotacji i karta opisowa](docs/adr/0008-pola-adnotacji-i-karta-opisowa.md)
  — wymowa, synonimy i rejestr formalny osobno; pytanie z opisu
