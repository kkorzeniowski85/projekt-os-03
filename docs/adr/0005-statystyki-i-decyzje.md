# ADR 0005 — Statystyki i decyzje o powtórkach

**Status:** zaakceptowany, częściowo zaimplementowany
**Data:** 2026-08-03

## Wymaganie

Aplikacja ma prowadzić dokładną statystykę, a na jej podstawie mają być
podejmowane decyzje o powtórkach konkretnych słów, fraz, wyrażeń i zdań.

## Fakt, który ustawia całą resztę

Sprawdzone w `fsrs` 6.3.1:

- `Optimizer(review_logs).compute_optimal_parameters()` → spersonalizowane wagi
  FSRS wyliczone z własnej historii,
- `Optimizer.compute_optimal_retention(parameters)` → optymalny poziom retencji,
  **ale wymaga co najmniej 512 powtórek i odrzuca zbiór, w którym choć jedna ma
  `review_duration = None`**.

Wniosek: **to, co zapisujemy dziś, wyznacza granicę tego, co da się policzyć
później.** Brakującego czasu odpowiedzi nie da się odtworzyć wstecz, a pojedynczy
brak psuje optymalizację dla całego konta.

Dlatego `review_log.review_duration_ms` jest **NOT NULL**, a `duration_ms` jest
wymagany w `POST /api/study/review`. Klient mierzy czas od pokazania pytania do
kliknięcia oceny.

## Kategoria materiału jako oś analizy

Doszła kolumna `notes.item_kind`: `word` / `phrase` / `expression` / `sentence` /
`other`.

Bez niej pytanie „jak mi idą zdania w porównaniu ze słowami" jest po prostu
nieodpowiadalne — a to jest sedno wymagania. Uśrednianie wszystkiego razem
ukrywa sygnał: 85% ogółem może oznaczać 95% na słowach i 60% na zdaniach, co jest
zupełnie inną diagnozą niż równe 85%.

Heurystyka rozpoznaje `word` (1 token), `sentence` (znak końca zdania albo ≥5
tokenów) i `phrase` (reszta). **`expression` nie jest zgadywane** — po treści nie
da się odróżnić idiomu od zwykłej frazy, a błędna etykieta zafałszowałaby
statystyki bardziej niż jej brak. Ustawia się je ręcznie albo mapuje z kolumny
źródła.

## Co jest liczone

Wszystko z `review_log`, bez osobnego magazynu i bez cache'u — nie ma więc
ryzyka, że statystyka rozjedzie się ze stanem kart.

| Endpoint | Zawartość |
|---|---|
| `/api/stats/overview` | powtórki, skuteczność (ogółem / świeże / utrwalone), czas nauki, passa, aktywność dzienna, rozkład ocen |
| `/api/stats/by-item-kind` | **to samo w rozbiciu na słowa / frazy / wyrażenia / zdania** |
| `/api/stats/by-tag` | rozbicie na tagi |
| `/api/stats/leeches` | materiał z największą liczbą wpadek |
| `/api/stats/forecast` | ile kart wypada do powtórki w kolejnych dniach |

### Skuteczność liczona uczciwie

Kluczowa metryka to **rzeczywista skuteczność** (true retention): odsetek
zaliczonych powtórek **wyłącznie wśród kart w stanie Review**. Powtórki w trakcie
nauki (Learning/Relearning) nie są wliczane — tam „Znowu" jest normalnym krokiem
algorytmu, nie porażką, i zaniżałoby wynik bez powodu.

Rozbicie na świeże (stabilność < 21 dni) i utrwalone (≥ 21 dni), bo zapomnienie
materiału świeżego znaczy co innego niż zapomnienie utrwalonego.

### Liczebność próbki jest zwracana zawsze

Każda skuteczność ma obok `retention_sample`. Poniżej 20 powtórek w grupie
zwracamy `null` zamiast liczby — 100% z trzech powtórek to nie jest wynik, to
szum, a pokazane jako „100%" prowokuje do złych decyzji.

## Od statystyki do decyzji — trzy mechanizmy

**1. Optymalizacja parametrów FSRS na własnej historii.** Docelowo: cykliczne
przeliczanie `user.fsrs_parameters` przez `Optimizer`. Kolumna już istnieje
i jest respektowana przez scheduler. **Nie zaimplementowane** — wymaga `torch`
(zależność rzędu setek MB) i ≥512 realnych powtórek, więc dziś nie da się tego
ani uruchomić, ani sprawdzić. Wchodzi, gdy log urośnie.

**2. Wyłapywanie materiału do przeformułowania.** `/stats/leeches` pokazuje karty
z dużą liczbą wpadek. Interpretacja jest w interfejsie postawiona wprost: wysoka
liczba wpadek przy niskiej stabilności zwykle nie znaczy „powtarzaj więcej", tylko
„fiszka jest źle sformułowana" — za dużo treści naraz, myli się z inną, brak
kontekstu.

**3. Rozładowanie kumulacji.** `/stats/forecast` pokazuje spiętrzenia zanim się
wydarzą.

## Świadomie odłożone

- **Automatyczne zmiany harmonogramu na podstawie statystyk.** Dziś statystyka
  informuje człowieka, nie steruje algorytmem. Osobne mnożniki interwałów per
  kategoria materiału byłyby modyfikacją FSRS bez dowodu, że pomaga — a mamy
  ścieżkę uczciwszą (punkt 1), która wagi wylicza z danych zamiast zgadywać.
- **Tabela dziennych agregatów.** Wszystko liczone na żywo z logu. Gdy zacznie
  być wolne, dojdzie cache — ale jako cache, nie jako źródło prawdy.
- **Skuteczność w podziale na porę dnia.** Dane są (`review_datetime`), zapytania
  nie ma.
- **Testy warstwy statystyk.** Zapytania są w SQL specyficznym dla PostgreSQL
  (JSONB, `FILTER`, `unnest`), więc test wymaga żywej bazy. Patrz ADR 0003.
