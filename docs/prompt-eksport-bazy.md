# Prompt: eksport bazy słówek do formatu `fiszki/v1`

Do wklejenia w **innym projekcie Claude'a** — tym, który ma w plikach bazę
słówek. Tamten Claude nie widzi tego repozytorium, więc prompt jest celowo
samowystarczalny: zawiera całą specyfikację formatu.

Wynik wrzucasz przez ekran **Import**. Mapowanie kolumn nie będzie potrzebne —
format jest już docelowy. Specyfikacja: [format-fiszki-v1.md](format-fiszki-v1.md).

Przed wysłaniem podmień dwa miejsca oznaczone `[…]`.

---

````text
W plikach tego projektu jest moja baza słówek. Przekształć ją na format JSON
`fiszki/v1`, opisany niżej. Zakres: [CAŁA BAZA / kategoria: ...].

## Zasady bezwzględne

1. Korzystaj WYŁĄCZNIE z danych, które są w projekcie. Nie dopisuj słówek
   z siebie i nie uzupełniaj brakujących tłumaczeń własną wiedzą.
2. Nie pomijaj niczego po cichu. Każda pozycja, której nie dało się przenieść
   (brak tłumaczenia, niejasny wpis, duplikat wewnętrzny), ma trafić do raportu
   na końcu — z powodem.
3. Kierunek jednolity w całym pliku: `front` = [JĘZYK, KTÓREGO SIĘ UCZĘ],
   `back` = polski. Nigdy odwrotnie, nawet jeśli w bazie bywa różnie.
4. `front` i `back` nigdy nie mogą być puste.

## Struktura pliku

{
  "format": "fiszki/v1",
  "deck": "nazwa talii",
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
      "note_type": "basic_reversed",
      "source_ref": "baza/1042"
    }
  ]
}

Wymagane są tylko `front` i `back`. Reszta pól jest opcjonalna, ale wypełnij je
wszędzie, gdzie baza daje podstawę.

## Pole `kind` — najważniejsze

Po tym polu aplikacja rozbija statystyki skuteczności. Pojedyncze słowo utrwala
się inaczej niż całe zdanie, więc pomyłka tutaj zafałszuje wnioski o nauce.

- `word` — pojedyncze słowo
- `phrase` — kilka słów o znaczeniu dosłownym („pół godziny", „open the door")
- `expression` — idiom albo zwrot stały, którego znaczenia NIE da się wywieść
  z pojedynczych słów („kick the bucket", „rzucać grochem o ścianę")
- `sentence` — pełne zdanie
- `other` — reszta

**`expression` musisz oznaczyć sam.** Aplikacja rozpozna automatycznie tylko
`word`, `phrase` i `sentence` — idiomu nie odróżni od zwykłej frazy, bo po samej
treści się nie da. Jeśli tego nie zaznaczysz, idiomy wtopią się we frazy
i statystyki przestaną pokazywać, że są trudniejsze.

## Pole `note_type` — ile kart powstanie

- `word`, `phrase`, `expression` → `"basic_reversed"` (2 karty: rozpoznawanie
  i produkcja — to dwie różne umiejętności)
- `sentence` → `"basic"` (1 karta; odtwarzanie całego zdania z tłumaczenia jest
  zwykle zadaniem nieporównanie trudniejszym, niż o to chodzi)

Ustaw je przy KAŻDEJ notatce osobno. Wartość przy notatce nadpisuje ustawienie
wybrane przy imporcie, więc talia może być mieszana.

## Pozostałe pola

- `example` — zdanie przykładowe, TYLKO jeśli jest w bazie. Nie wymyślaj.
  Nie wchodzi do wykrywania duplikatów, więc można je dopisać później.
  **Samo zdanie** — wymowy, synonimów ani odpowiednika formalnego tu nie wklejaj,
  mają własne pola niżej.
- `pronunciation` — zapis wymowy, jeśli baza go ma (np. `/juːˈbɪkwɪtəs/`).
- `synonyms` — wyrażenia **wymienne w zdaniu**, nie definicje: z tego pola
  powstaje osobna karta, w której synonim jest pytaniem, a termin odpowiedzią.
  Definicja zawierająca sam termin zdradziłaby odpowiedź. Człony rozdzielaj
  ukośnikiem ze spacjami (`a / b`) albo podaj tablicę.
- `formal` — odpowiednik formalny, jeśli baza rozróżnia rejestr.
- `tags` — przenieś kategorie, poziomy i części mowy z bazy. Małe litery,
  bez znaków specjalnych. Nie wymyślaj tagów, których baza nie ma.
- `source_ref` — stabilny identyfikator pozycji w bazie (np. `"baza/1042"` albo
  `"baza/czasowniki/go"`). Pozwoli rozpoznać tę samą pozycję przy kolejnym
  eksporcie, gdy baza urośnie.

## Wymagania techniczne

- Zapisz jako plik `.json` w kodowaniu UTF-8. Nie wklejaj treści do czatu.
- Czysty JSON: bez ogrodzeń ```json, bez komentarzy, bez przecinka po ostatnim
  elemencie. Plik ma się parsować `json.loads` bez żadnej obróbki.
- Maksymalnie 500 notatek na plik. Przy większej bazie podziel na
  `fiszki-01.json`, `fiszki-02.json`, … — każdy z pełną kopertą.
- Duplikaty między plikami są nieszkodliwe (import je rozpozna po treści
  i pominie), więc nie kombinuj przy podziale — dziel po prostu po kolei.

## Raport na końcu

W czacie, NIE w pliku, podaj:

1. Ile notatek w każdym pliku i łącznie.
2. Rozbicie: ile `word`, `phrase`, `expression`, `sentence`, `other`.
3. Pełną listę pozycji z bazy, których nie przeniosłeś — każda z powodem.
4. Pozycje, przy których zgadywałeś `kind` albo kierunek, jeśli takie były.
````

---

## Dodatek dla materiału OET

Doklej ten blok na **koniec** promptu powyżej, jeśli źródłem jest baza do OET.
Materiał egzaminacyjny ma strukturę, której zwykła lista słówek nie ma, i bez
tego zostałaby spłaszczona.

````text
## Dodatkowo: to jest materiał do OET

Baza służy przygotowaniu do Occupational English Test. Zrób z niej TRZY osobne
pliki, bo to trzy różne umiejętności i mają się uczyć niezależnie:

**Plik A — terminologia** (`deck`: "OET — terminologia")
`front` = termin angielski, `back` = polski odpowiednik.
`kind`: `word` dla pojedynczych terminów, `phrase` dla kolokacji.

**Plik B — rejestr** (`deck`: "OET — rejestr pacjenta")
`front` = termin medyczny po angielsku, `back` = wytłumaczenie tego samego
prostym angielskim, tak jak powiedziałbyś pacjentowi.
Przykład: `front`: "myocardial infarction", `back`: "a heart attack — when blood
can't reach part of the heart muscle".
To jest osobny plik, bo tłumaczenie terminu na polski i wytłumaczenie go
pacjentowi po angielsku to dwie różne rzeczy, a OET sprawdza tę drugą.
`kind`: `word` albo `phrase` wg terminu. `note_type`: `"basic"` — kierunek
odwrotny (opis → termin) nie ćwiczy tej umiejętności.

**Plik C — zwroty komunikacyjne** (`deck`: "OET — zwroty")
`front` = intencja albo sytuacja po polsku ("uprzedzenie o badaniu, które może
boleć"), `back` = gotowy zwrot angielski.
`kind`: `expression` dla utartych formuł, `sentence` dla pełnych zdań.
`note_type`: `"basic"` — chodzi o produkcję, nie rozpoznawanie.

## Tagi dla OET

Oprócz tagów z bazy dodaj, gdzie pasuje:
- podtest: `listening`, `reading`, `writing`, `speaking`
- obszar: `anatomia`, `objawy`, `leki`, `procedury`, `badania`, `wywiad`,
  `diagnoza`, `leczenie`
- funkcja językowa (plik C): `empatia`, `wyjasnianie`, `pytanie`, `uprzedzenie`,
  `sprawdzanie-zrozumienia`, `zalecenia`

## Uwaga o `expression` w materiale medycznym

W angielszczyźnie klinicznej bardzo dużo jest zwrotów półidiomatycznych:
„rule out", „take a history", „follow up", „present with", „work up".
Znaczenia nie da się złożyć ze słów składowych, więc to `expression`, nie
`phrase`. To najczęstszy błąd przy takiej bazie i akurat tutaj kosztowny —
te zwroty są trudniejsze niż zwykłe kolokacje i statystyki mają to pokazać.
````

## Po wygenerowaniu

1. Wrzuć plik przez ekran **Import** — format wykryje się sam.
2. W podglądzie sprawdź kolumny **Kategoria** i **Karty**. Przy pozycjach
   z ustawionym `note_type` zobaczysz dopisek „z pliku".
3. Zatwierdź. Przy kolejnych plikach zostaw włączone pomijanie duplikatów.

Punkt 3 raportu jest ważniejszy, niż wygląda: to lista rzeczy, które inaczej
zniknęłyby bez śladu. Warto ją przejrzeć, zanim uznasz eksport za kompletny.
