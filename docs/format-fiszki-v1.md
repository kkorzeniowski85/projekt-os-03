# Format `fiszki/v1`

Format docelowy aplikacji. Każde inne źródło (Anki, CSV, tekst) jest do niego
sprowadzane przy imporcie. Jest też formatem, w którym najwygodniej **zamówić
gotową talię** — nie wymaga zgadywania kolumn, więc import przechodzi bez
mapowania.

## Struktura

```json
{
  "format": "fiszki/v1",
  "deck": "Angielski B2",
  "default_note_type": "basic_reversed",
  "notes": [
    {
      "front": "ubiquitous",
      "back": "wszechobecny",
      "example": "Smartphones are ubiquitous these days.",
      "pronunciation": "/juːˈbɪkwɪtəs/",
      "synonyms": "omnipresent / found everywhere",
      "formal": "prevalent throughout",
      "tags": ["b2", "przymiotnik"],
      "kind": "word",
      "source_ref": "oxford-3000/ubiquitous"
    }
  ]
}
```

## Pola notatki

| Pole | Wymagane | Opis |
|---|---|---|
| `front` | **tak** | Strona pytania |
| `back` | **tak** | Strona odpowiedzi |
| `example` | nie | Zdanie przykładowe. Pokazywane razem z odpowiedzią, nie wchodzi do wykrywania duplikatów |
| `pronunciation` | nie | Zapis wymowy, np. `/juːˈbɪkwɪtəs/` |
| `synonyms` | nie | Wyrażenia **wymienne w zdaniu**. Z nich powstaje pytanie karty „opis → termin", więc definicja zawierająca sam termin zdradziłaby odpowiedź |
| `formal` | nie | Odpowiednik formalny (rejestr, którego wymaga OET) |
| `tags` | nie | Lista tagów |
| `kind` | nie | `word` \| `phrase` \| `expression` \| `sentence` \| `other`. Bez tego kategoria jest zgadywana z treści `front` |
| `note_type` | nie | `basic` (1 karta) albo `basic_reversed` (2 karty). **Wygrywa z typem wybranym na ekranie importu** — patrz niżej. Bez tego obowiązuje typ z importu |
| `source_ref` | nie | Identyfikator w źródle — pozwala rozpoznać tę samą pozycję przy ponownym imporcie |
| `deck` | nie | Nadpisuje `deck` z koperty (informacyjnie — import i tak trafia do jednej wybranej talii) |

## Pola koperty

| Pole | Wymagane | Opis |
|---|---|---|
| `format` | nie | `"fiszki/v1"`. Inna wartość daje ostrzeżenie, nie błąd |
| `deck` | nie | Informacyjna nazwa źródła. **Nie tworzy talii** — materiał trafia domyślnie do Słownika (bazy głównej); nazwa służy tylko jako podpowiedź, gdy użytkownik świadomie wybierze osobną talię |
| `default_note_type` | nie | Domyślny typ notatki. Domyślnie `basic` |
| `notes` | **tak** | Lista notatek |

Przyjmowana jest też naga lista notatek bez koperty — wtedy obowiązują wartości
domyślne.

## Dlaczego `kind` ma znaczenie

To po tym polu rozbijane są statystyki. Pojedyncze słowo utrwala się inaczej niż
całe zdanie, więc uśrednianie ich razem zaciemnia obraz: 85% skuteczności ogółem
może ukrywać 95% na słowach i 60% na zdaniach — a to dwie różne diagnozy
i dwie różne reakcje.

Heurystyka rozpozna `word`, `phrase` i `sentence` z samej treści. **`expression`
(idiom, zwrot stały) musi być podane wprost** — po treści nie da się go odróżnić
od zwykłej frazy, a błędna etykieta zafałszowałaby statystyki bardziej niż jej
brak.

## Typ notatki: jeden na plik czy osobno dla pozycji

Talia z prawdziwej kolekcji jest mieszana, a te dwa przypadki chcą różnych rzeczy:

- **słowo lub fraza** → `basic_reversed`. Rozpoznawanie (obce → polskie) i produkcja
  (polskie → obce) to dwie różne umiejętności i utrwalają się osobno.
- **całe zdanie** → `basic`. Odtwarzanie pełnego zdania z tłumaczenia jest zadaniem
  nieporównanie trudniejszym niż jego rozpoznanie i zwykle nie o to chodzi.

Dlatego `note_type` przy pojedynczej pozycji **nadpisuje** typ wybrany na ekranie
importu. Jeden typ narzucony na cały plik oznaczałby albo bezużyteczne karty
wsteczne przy zdaniach, albo utratę kierunku produkcji przy słowach.

Kolejność decyzji: `note_type` pozycji → typ wybrany przy imporcie →
`default_note_type` z koperty → `basic`.

## Pełna instrukcja tworzenia pliku

[jak-tworzyc-fiszki.md](jak-tworzyc-fiszki.md) — wersja do dania Claude'owi:
z przykładami, typowymi błędami i tym, co robić przy kolejnych wersjach
materiału. Ten dokument jest specyfikacją formatu, tamten — poradnikiem.

## Deduplikacja

**Do odcisku wchodzą wyłącznie `front` i `back`.** Zasada: pole, którego
zmiana nie może utworzyć nowej fiszki, nie wchodzi do odcisku — dopisanie
wymowy nie czyni słowa innym słowem. Gdyby weszły, jedno uzupełnienie
zamieniłoby się z aktualizacji w duplikaty.

Listy (`synonyms`, `formal`) można podać jako tablicę albo jako napis
z członami rozdzielonymi **ukośnikiem ze spacjami**: `a / b`. Ukośnik bez
spacji zostaje częścią członu (`temporary/covering doctor`).

Import porównuje odcisk treści (`front` + `back`, bez uwzględniania wielkości
liter i białych znaków). Ta sama fiszka z dwóch różnych źródeł zostanie
rozpoznana jako jedna. Dopisanie `example` nie czyni fiszki nową.

Gdy pozycja już jest w kolekcji, ekran importu daje trzy wyjścia:

| Tryb | Co robi |
|---|---|
| **Pomiń** (domyślnie) | Nie rusza istniejącej. Import tylko dokłada nowy materiał |
| **Uzupełnij** | Dopisuje `example`, `tags` i `kind` do istniejącej fiszki. Nie kasuje tego, czego plik nie ma; tagi się sumują; kategoria zgadnięta nie nadpisze ustawionej ręcznie. **Stan powtórek i liczba kart bez zmian** |
| **Dodaj** | Tworzy drugą fiszkę o tej samej treści — zwykle niepożądane |

Aktualizacja celowo nie zmienia `note_type`: zmiana typu oznacza skasowanie
karty razem z jej stanem FSRS, więc robi się to świadomie przez „Edytuj".

## Dokąd trafia import

Domyślnym celem importu jest **Słownik** — baza główna aplikacji, która
istnieje zawsze i której nie można usunąć w całości. Wgrany materiał rozpływa
się w niej zamiast tworzyć osobną grupę. Generując plik, **nie wymyślaj nazw
talii** — pole `deck` zostaw puste albo czysto informacyjne.

## Pakiet wbudowany

Plik w tym formacie może też jechać **razem z aplikacją**: w katalogu
`frontend/public/slownik/` (ADR 0007). Wtedy każde urządzenie dowozi sobie
różnicę po otwarciu, bez ekranu Import. Dwa dodatkowe wymagania: każda pozycja
ma stały `source_ref` (po nim trafiają poprawki), a ta sama treść nie może być
w dwóch plikach. Szczegóły w [jak-tworzyc-fiszki.md](jak-tworzyc-fiszki.md).

## Jak zamówić talię w tym formacie

Wystarczy poprosić wprost, np.:

> Wygeneruj 50 fiszek angielski→polski, poziom B2, słownictwo biznesowe,
> w formacie fiszki/v1. Do każdej dodaj zdanie przykładowe i ustaw `kind`.

Wynik zapisz jako `.json` i wrzuć przez ekran **Import**. Mapowanie kolumn nie
będzie potrzebne — format jest już docelowy.
