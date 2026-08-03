# ADR 0002 — Model synchronizacji i rozwiązywania konfliktów

**Status:** zaakceptowany (implementacja odłożona)
**Data:** 2026-08-03

## Problem

Aplikacja ma działać na kilku urządzeniach jednocześnie. Pełne CRDT to za duży
narzut na MVP, ale „last write wins" bez zastanowienia gubi dane w najbardziej
bolesnym przypadku: uczysz się offline w pociągu na telefonie, wieczorem
siadasz do laptopa, a pierwszy sync kasuje jedną z sesji.

Decyzja musiała zapaść **przed** schematem bazy, bo determinuje kształt tabel.

## Decyzja

Nie stosujemy jednej strategii do wszystkiego. Dane dzielą się na trzy klasy:

### 1. Treść — LWW po `updated_at`

Pola notatki, tagi, przypisanie do talii, ustawienia talii. Wygrywa nowszy
`updated_at`. Przegrana wersja trafia do tabeli `sync_conflicts` (do dopisania
razem z synchronizacją), żeby nic nie ginęło bezpowrotnie.

Uzasadnienie: równoległa edycja tej samej fiszki na dwóch urządzeniach jest
rzadka, a konsekwencja pomyłki mała i odwracalna.

### 2. Historia powtórek — append-only log zdarzeń

`review_log` nigdy nie jest modyfikowany ani kasowany. Każde zdarzenie ma
`client_event_id` (UUID nadany przez urządzenie), a `UNIQUE (user_id,
client_event_id)` czyni wysyłkę idempotentną — ponowienie po zerwaniu sieci nie
zdubluje wpisu.

Uzasadnienie: dwie sesje nauki wykonane offline to nie konflikt, tylko dwa
zbiory faktów. Oba są prawdziwe i oba mają zostać.

### 3. Stan FSRS karty — **nie synchronizowany**, przeliczany z logu

Kolumny `state`, `step`, `stability`, `difficulty`, `due`, `reps`, `lapses`
w tabeli `cards` to zmaterializowany wynik odtworzenia `review_log`. Przy
scalaniu sortujemy zdarzenia po `review_datetime` i odtwarzamy je po kolei.

Uzasadnienie: stan jest funkcją historii, nie niezależnym bytem. To eliminuje
całą klasę konfliktów zamiast je rozstrzygać.

### 4. Usunięcia — soft delete

`deleted_at` zamiast `DELETE`. Bez tombstone'ów rekord usunięty na telefonie
„odżywa" po syncu z laptopa, który o usunięciu nie wie.

## Konsekwencje

**Fuzzing FSRS musi być wyłączony.** Biblioteka domyślnie losowo rozrzuca
interwały (`enable_fuzzing=True`), żeby powtórki nie zlepiały się w jeden dzień.
To czyni scheduler funkcją nieczystą — odtworzenie tego samego logu dałoby inny
wynik na każdym urządzeniu, czyli punkt 3 przestałby działać.

Wybieramy determinizm. Cena: powtórki mogą się lekko zlepiać. Zysk:
bezkonfliktowe scalanie. Ustawione w `app/core/scheduler.py`
(`ENABLE_FUZZING = False`).

**Klucze główne to UUID, nie sekwencje.** Urządzenie offline musi umieć nadać id
lokalnie, zanim zobaczy serwer.

**`review_log` przechowuje `state_before` i `state_after`.** Replay jest ścieżką
scalania, ale zapisany stan pozwala audytować i wykryć rozjazd bez odtwarzania
całej historii. Kolumna `scheduler_version` mówi, która wersja algorytmu i wag
wyprodukowała dany wpis — przy zmianie parametrów FSRS będzie wiadomo, co
przeliczyć.

**Powtórki wsteczne są dziś odrzucane.** `POST /api/study/review` zwraca 409,
gdy `reviewed_at < card.last_review`. Poprawna obsługa wymaga replayu, czyli
wejdzie razem z synchronizacją. Lepiej odmówić niż po cichu zepsuć stan karty.

## Odrzucone alternatywy

- **Pełne CRDT (Yjs / Automerge).** Rozwiązuje problem u źródła, ale to osobny
  model danych i tygodnie pracy. Wracamy do tego tylko jeśli LWW okaże się
  realnie bolesny.
- **LWW na wszystkim, łącznie ze stanem FSRS.** Prostsze o jeden dzień pracy,
  ale gubi sesje nauki — dokładnie to, czego użytkownik nie wybaczy.
- **Blokady / sync wyłącznie online.** Zabija sens aplikacji mobilnej.
