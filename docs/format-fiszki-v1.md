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
| `tags` | nie | Lista tagów |
| `kind` | nie | `word` \| `phrase` \| `expression` \| `sentence` \| `other`. Bez tego kategoria jest zgadywana z treści `front` |
| `note_type` | nie | `basic` (1 karta) albo `basic_reversed` (2 karty). Bez tego obowiązuje `default_note_type` |
| `source_ref` | nie | Identyfikator w źródle — pozwala rozpoznać tę samą pozycję przy ponownym imporcie |
| `deck` | nie | Nadpisuje `deck` z koperty (informacyjnie — import i tak trafia do jednej wybranej talii) |

## Pola koperty

| Pole | Wymagane | Opis |
|---|---|---|
| `format` | nie | `"fiszki/v1"`. Inna wartość daje ostrzeżenie, nie błąd |
| `deck` | nie | Sugerowana nazwa talii |
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

## Deduplikacja

Import porównuje odcisk treści (`front` + `back`, bez uwzględniania wielkości
liter i białych znaków). Ta sama fiszka z dwóch różnych źródeł zostanie
rozpoznana jako jedna. Dopisanie `example` nie czyni fiszki nową.

## Jak zamówić talię w tym formacie

Wystarczy poprosić wprost, np.:

> Wygeneruj 50 fiszek angielski→polski, poziom B2, słownictwo biznesowe,
> w formacie fiszki/v1. Do każdej dodaj zdanie przykładowe i ustaw `kind`.

Wynik zapisz jako `.json` i wrzuć przez ekran **Import**. Mapowanie kolumn nie
będzie potrzebne — format jest już docelowy.
