# ADR 0003 — Znane uproszczenia szkieletu

**Status:** obowiązujący
**Data:** 2026-08-03

Lista rzeczy świadomie uproszczonych w szkielecie, żeby nie odkrywać ich później
jako „bugów". Każda ma wpis, kiedy wraca.

## Dzień nauki liczony w UTC

`day_start()` w `app/api/study.py` przesuwa granicę doby na 4:00 (nauka po
północy liczy się do dnia poprzedniego), ale liczy to w **UTC**. Dla użytkownika
w Polsce granica wypada o 5:00 albo 6:00 czasu lokalnego, zależnie od pory roku.

**Wraca:** razem z ustawieniami użytkownika — dochodzi kolumna `timezone`
i liczenie granicy w strefie użytkownika.

## Limity dzienne liczone tylko per talia

`GET /api/study/queue` wymaga `deck_id`. Nie ma trybu „ucz się ze wszystkiego",
bo przy wielu taliach limity `new_per_day` musiałyby być dzielone między nie
według jakiejś reguły, a ta reguła to osobna decyzja.

**Wraca:** gdy pojawi się więcej niż kilka talii i realna potrzeba.

## Kolejka nie miesza nowych z powtórkami

Najpierw wszystkie zaległe, potem nowe. Anki przeplata je według konfiguracji.

**Wraca:** kosmetyka, do zrobienia kiedykolwiek.

## Talie są płaskie

Brak hierarchii `Rodzic::Dziecko` znanej z Anki. Model tego nie blokuje —
dojdzie kolumna `parent_id`.

## Typy notatek są wbudowane

`basic` i `basic_reversed`, pola `Front`/`Back` zaszyte w
`app/core/rendering.py`. Kolumna `fields` jest już JSONB, więc dodanie pól nie
wymaga migracji — wymaga silnika szablonów.

**Wraca:** jeśli import z Anki napotka talie z niestandardowymi typami notatek.

## Media: tabela bez warstwy plików

Tabela `media` istnieje, endpointów uploadu nie ma. Fiszki są dziś czysto
tekstowe.

**Wraca:** przed importem `.apkg` z obrazkami — gotowe talie często ich używają.

## Rate limiting trzyma stan w pamięci procesu

`slowapi` bez backendu Redis. Przy jednym procesie uvicorna działa poprawnie;
przy wielu workerach każdy liczy limit osobno, więc efektywny limit jest
N-krotnie wyższy.

**Wraca:** przy deployu, jeśli backend pójdzie na więcej niż jeden worker.

## Testy pokrywają na razie tylko importery

`backend/tests/test_importers.py` — 47 testów, bez bazy (parsery to czyste
funkcje; pliki `.apkg` budowane są syntetycznie w obu wariantach schematu Anki).

Nie pokryte testami automatycznymi: warstwa statystyk (zapytania w SQL
specyficznym dla PostgreSQL — wymagają żywej bazy), cykl FSRS na karcie,
idempotencja `client_event_id`, izolacja danych między użytkownikami. Do
sprawdzenia przez `scripts/smoke_e2e.py`, który przechodzi je end-to-end.

## Import idzie synchronicznie

Analiza i zapis wykonują się w trakcie żądania HTTP. Przy 20 tys. fiszek to
kilkanaście sekund oczekiwania.

**Wraca:** gdy zacznie przeszkadzać — wtedy zadanie w tle.

## Import nie odtwarza podziału na talie ze źródła

`.apkg` może zawierać wiele talii. Nazwy są odczytywane i pokazywane w podglądzie,
ale cały import trafia do jednej wybranej talii.

## Optymalizacja FSRS na własnej historii nie jest wpięta

`fsrs.Optimizer` wymaga `torch` (setki MB) i ≥512 powtórek. Kolumna
`users.fsrs_parameters` już istnieje i jest respektowana przez scheduler, więc
wpięcie to dodanie zależności i zadania przeliczającego — bez zmian schematu.
Szczegóły w [ADR 0005](0005-statystyki-i-decyzje.md).

## Podatności w zależnościach build-time

`npm audit` zgłasza 3 podatności wysokie w `postcss` i `sharp` zaciąganych przez
Next 16.2.12. `npm audit fix --force` cofnęłoby Next do 9.3.3, więc nie jest to
opcja. Dotyczą procesu budowania, nie kodu wystawionego użytkownikom.

**Wraca:** przy kolejnej aktualizacji Next.
