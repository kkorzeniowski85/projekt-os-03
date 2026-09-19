# Jak stworzyć plik źródłowy z fiszkami

Instrukcja dla Claude'a (i dla Ciebie). Format `fiszki/v1` to docelowy format
aplikacji — plik w nim wchodzi przez ekran **Import** bez mapowania kolumn.

Krótka wersja do wklejenia w czacie jest pod przyciskiem **„Skopiuj instrukcję
dla Claude'a"** na ekranie Import. Ten dokument to wersja pełna: z przykładami,
typowymi błędami i tym, co robić przy kolejnych wersjach pliku.

---

## Minimalny plik

```json
{
  "format": "fiszki/v1",
  "notes": [
    { "front": "to rule out", "back": "wykluczyć (rozpoznanie)" }
  ]
}
```

Wymagane są wyłącznie `front` i `back`. Wszystko inne jest opcjonalne, ale
każde pominięte pole to informacja, którą aplikacja musi zgadnąć albo utracić.

## Pełna pozycja

```json
{
  "front": "to rule out",
  "back": "wykluczyć (rozpoznanie)",
  "example": "We need to rule out a bleed before giving pain relief.",
  "tags": ["oet", "nhs"],
  "kind": "expression",
  "note_type": "basic_reversed",
  "source_ref": "oet-nhs/n5/to-rule-out"
}
```

| Pole | Po co |
|---|---|
| `front` | Strona pytania — to, czego się uczysz |
| `back` | Strona odpowiedzi — zwykle polski |
| `example` | Zdanie przykładowe — **musi zawierać uczony zwrot** (patrz niżej). Widać je dopiero po odsłonięciu odpowiedzi, więc nie podpowiada. Może mieć wiele linii |
| `pronunciation` | Zapis wymowy. Aplikacja pokazuje go przy odpowiedzi |
| `synonyms` | Wyrażenia **wymienne w zdaniu** — patrz niżej, to z nich powstaje osobna karta |
| `formal` | Odpowiednik formalny — rejestr, którego wymaga OET |
| `tags` | Do filtrowania i statystyk po tagach |
| `kind` | **Oś statystyk** — patrz niżej, to najważniejsze pole opcjonalne |
| `note_type` | Ile kart powstanie: `basic` = 1, `basic_reversed` = 2 |
| `source_ref` | Identyfikator w źródle. Pomaga rozpoznać pozycję przy kolejnym eksporcie |

**Nie dodawaj pola `deck`.** Materiał trafia do Słownika — jednej wspólnej bazy.
Nazwy talii nie są aplikacji potrzebne i tylko mnożą grupy.

## `example` — zdanie musi zawierać uczony zwrot

To jedyny warunek, ale twardy. Zdanie „na temat", w którym samego zwrotu nie ma,
jest do nauki bezużyteczne — pokazuje kontekst, a nie użycie.

```
front: "to rule out"
✅ "We need to rule out a bleed before giving pain relief."
❌ "The diagnosis was uncertain at that point."   ← na temat, ale bez zwrotu
```

Zwrot może być **odmieniony** — tak nawet lepiej, bo pokazuje żywe użycie:
`to fob someone off` → *„The council keeps **fobbing me off** with excuses."*

Gdy w `front` stoi placeholder (`someone`, `something`, `one's`), w zdaniu
podstaw konkret — `to give someone a heads-up` → *„Just wanted to **give you a
heads-up** about the ward closure."*

Jeśli materiał źródłowy nie ma przykładu dla danej pozycji, zostaw pole puste.
Lepszy brak niż zmyślony.

## `synonyms` — wymienne wyrażenia, nie definicje

Z tego pola aplikacja robi osobną kartę: pytaniem jest synonim, odpowiedzią
uczony termin. Dla OET to ćwiczenie parafraz, na których w dużej mierze stoją
części Listening i Reading.

Stąd jedno twarde wymaganie: synonim musi dać się **wstawić w zdanie zamiast
terminu**.

```
front: "pyrexia"
✅ "fever / high temperature"        ← wymienne w zdaniu
❌ "a pyrexia is a raised body temperature"   ← definicja, i zdradza termin
```

Definicja zawierająca sam termin jest odrzucana automatycznie (karta by się
nie utworzyła), ale definicja bez terminu utworzy kartę o miernej wartości.

**Nie wklejaj synonimów, wymowy ani odpowiednika formalnego do `example`.**
Każde ma własne pole. Wklejone w przykład zaśmiecają zdanie i nie dają się
użyć osobno — ten właśnie nawyk trzeba było potem rozplątywać.

## `kind` — cztery kategorie, jedna do oznaczenia ręcznie

Po tym polu aplikacja rozbija skuteczność nauki. Pojedyncze słowo utrwala się
inaczej niż całe zdanie, więc uśrednianie ich razem zaciemnia obraz: 85% ogółem
może ukrywać 95% na słowach i 60% na zdaniach — a to dwie różne diagnozy.

- **`word`** — pojedyncze słowo: `exacerbation`, `unremarkable`
- **`phrase`** — kilka słów o znaczeniu dosłownym: `clotting profile`, `pół godziny`
- **`expression`** — idiom albo zwrot, którego znaczenia **nie da się złożyć ze
  słów składowych**: `to rule out`, `kick the bucket`, `rzucać grochem o ścianę`
- **`sentence`** — pełne zdanie: `Could I have the results, please?`

Heurystyka aplikacji rozpozna sama `word`, `phrase` i `sentence`. **`expression`
musisz oznaczyć sam** — po samej treści nie da się odróżnić idiomu od zwykłej
frazy, a błędna etykieta zafałszuje statystyki bardziej niż jej brak.

W angielszczyźnie klinicznej bardzo dużo jest zwrotów półidiomatycznych:
`rule out`, `take a history`, `follow up`, `present with`, `work up`. To
`expression`, nie `phrase` — i akurat te są trudniejsze niż zwykłe kolokacje,
więc statystyki mają to pokazać.

## `note_type` — w jedną stronę czy w obie

- **`basic_reversed`** (2 karty) dla słów i fraz. Rozpoznawanie (obce → polskie)
  i produkcja (polskie → obce) to dwie różne umiejętności i utrwalają się osobno.
- **`basic`** (1 karta) dla zdań i zwrotów, które mają się tylko kojarzyć.
  Odtwarzanie pełnego zdania z tłumaczenia jest zadaniem nieporównanie
  trudniejszym i zwykle nie o to chodzi.

Wartość przy pozycji wygrywa z ustawieniem wybranym na ekranie importu, więc
jeden plik może mieszać oba typy.

## Wymagania techniczne

- Plik `.json`, kodowanie **UTF-8**
- **Czysty JSON**: bez ogrodzeń ```` ```json ````, bez komentarzy, bez przecinka
  po ostatnim elemencie. Ma się parsować bez żadnej obróbki
- Maksymalnie ~500 pozycji na plik. Przy większym materiale podziel na
  `fiszki-01.json`, `fiszki-02.json` — każdy z własną kopertą
- Duplikaty między plikami są nieszkodliwe: import rozpoznaje je po treści

Przyjmowana jest też naga lista bez koperty (`[{...}, {...}]`) — wtedy
obowiązują wartości domyślne.

## Kolejne wersje tego samego materiału

Aplikacja rozpoznaje duplikaty po **odcinku treści z przodu i tyłu**, odpornym
na różnice formatowania i wielkość liter. Przykład, tagi i kategoria **nie
wchodzą** do tego odcisku.

Praktyczny wniosek: jeśli wrócisz do materiału i dopiszesz przykłady albo tagi,
**zaimportuj ten sam plik ponownie** i na ekranie importu wybierz
**„Uzupełnij o to, co jest w pliku"**. Wtedy:

- przykład, tagi i kategoria zostaną dopisane do istniejących fiszek
- **stan powtórek i historia nauki pozostają nietknięte** — nie zaczynasz od zera
- tagi się sumują, nic nie ginie
- brak pola w nowym pliku **nie kasuje** tego, co już jest
- kategoria zgadnięta przez heurystykę nie nadpisze tej ustawionej ręcznie

Czego aktualizacja **nie** robi: nie zmienia `note_type`. Zmiana typu oznacza
skasowanie karty razem z jej stanem nauki, więc robi się to świadomie przez
„Edytuj" przy konkretnej fiszce.

## Plik do pakietu wbudowanego

Gdy plik ma dotrzeć na telefon przez repozytorium, a nie przez ekran Import,
ląduje w `frontend/public/slownik/`. Manifest z odciskami generuje się sam
przy budowaniu, a każde urządzenie dowozi sobie różnicę przy następnym
otwarciu (ADR 0007). Skrypt pilnuje dwóch dodatkowych wymagań:

- **każda pozycja ma `source_ref`** — stały, unikalny identyfikator, np.
  `oet-core/m103`. Po nim aplikacja odnajduje fiszkę, gdy poprawka tłumaczenia
  zmieni odcisk treści. Bez niego poprawka utworzyłaby drugą fiszkę obok starej
- **jedna treść, jedno źródło** — ta sama para przód/tył nie może być w dwóch
  plikach pakietu

`source_ref` raz nadany **nie zmienia się nigdy** — to on jest tożsamością
fiszki między wersjami pakietu. Poprawiasz tłumaczenie, przykład, tagi,
kategorię; identyfikator zostaje.

## Czego nie robić

**Nie wymyślaj materiału.** Jeśli tworzysz plik ze zdjęcia, listy albo notatek —
korzystaj wyłącznie z tego, co tam jest. Czego nie da się odczytać, wypisz na
końcu odpowiedzi jako listę pominiętych pozycji z powodem. Dopisane „pasujące do
tematu" słówka wejdą do Słownika nierozpoznane jako obce i będziesz się ich uczyć
jak własnych.

**Nie zgaduj tłumaczeń.** Brakujące `back` to powód do zgłoszenia pozycji, nie do
uzupełnienia z pamięci.

**Nie wymyślaj przykładów**, chyba że poproszę wprost. Przykład z materiału
źródłowego niesie kontekst, w którym zwrot naprawdę wystąpił.

## Raport na końcu

Po wygenerowaniu pliku podaj **w czacie, nie w pliku**:

1. Ile pozycji zawiera plik
2. Rozbicie: ile `word`, `phrase`, `expression`, `sentence`
3. Pełną listę pozycji, których nie udało się przenieść — każda z powodem
4. Pozycje, przy których zgadywałeś kategorię albo kierunek

Punkt 3 jest ważniejszy, niż wygląda: to lista rzeczy, które inaczej zniknęłyby
bez śladu.
