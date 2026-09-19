# 0008 — Wymowa, synonimy i rejestr formalny jako osobne pola; karta „opis → termin"

Data: 2026-09-19. Status: obowiązuje. Uzupełnia ADR 0006 i 0007.

## Kontekst

Materiał z trackerów OET wszedł do aplikacji, gdy notatka miała trzy pola:
przód, tył, przykład. Wymowa, synonimy i odpowiednik formalny nie miały gdzie
mieszkać, więc zostały **sklejone w pole `Example`**, linia po linii:

```
/tə tʃeɪz ʌp/
Formalnie (OET): to follow up on / to enquire about the status of

I'll chase up the estate agent about the contract tomorrow.
```

Pomiar na 229 fiszkach pakietu: 143 mają wiersz `Synonimy:`, 86 ma wymowę IPA
i `Formalnie (OET):`, zero przypadków mieszanych i zero wyjątków od tego
kształtu. Koszt sklejenia: zdanie przykładowe jest zaśmiecone, a same
adnotacje nie dają się użyć osobno — ani pokazać w swoim miejscu na karcie,
ani przeczytać na głos, ani zrobić z nich pytania.

## Decyzja

Trzy nowe pola notatki — `Pronunciation`, `Synonyms`, `Formal` — oraz trzeci
kierunek karty: **opis → termin** (`templateOrd: 2`).

### Co NIE wchodzi do odcisku treści

Odcisk (`contentHash`) liczy się nadal wyłącznie z pary `Front` + `Back`.
Zasada: **pole, którego zmiana nie może utworzyć nowej fiszki, nie wchodzi do
odcisku.** Dopisanie wymowy nie czyni słowa innym słowem. Gdyby nowe pola
weszły, jedno uzupełnienie z pakietu zamieniłoby 229 aktualizacji w 229
duplikatów.

### Naprawa sterowana danymi zamiast migracji schematu

Schemat IndexedDB **nie zmienia się** — `DB_VERSION` zostaje 1, `upgrade()`
nietknięte. Rozbiór starego pola robi zwykła funkcja (`naprawPrzyklady`),
wołana przy starcie aplikacji, po dostawie pakietu, po imporcie i po
przywróceniu kopii.

Dlaczego nie gałąź `upgrade()`: żaden sklep ani indeks nie wymaga zmiany,
a kod w `upgrade()` wykonałby się na telefonie dokładnie raz, w warunkach,
których nie da się powtórzyć w testach. Funkcja wołana wielokrotnie jest
zbieżna (drugi przebieg nic nie zmienia) i daje się przetestować.

Dodatkowo **odczyt rozbiera w locie** (`render.ts`): `exampleOf`, `cueOf`,
`pronunciationOf` i `formalOf` czytają najpierw właściwe pole, a gdy go nie ma,
rozbierają `Example`. Dzięki temu **ekran nauki jest poprawny niezależnie od
tego, czy naprawa zdążyła się wykonać**. Naprawa jest porządkiem, nie
warunkiem poprawności — i przywrócona stara kopia zapasowa działa od razu.

Czego naprawa nie robi: nie dotyka `Front`/`Back` (odcisk bez zmian), nie
ustawia `editedAt` (to nie jest ręczna poprawka użytkownika — taki znacznik
odciąłby fiszkę od poprawek pakietu **na zawsze**), nie tworzy i nie kasuje
kart, nie liczy odcisków (żadnego `await` na `crypto.subtle`).

### Wskazówką karty opisowej są WYŁĄCZNIE synonimy

Odpowiednik formalny celowo **nie** jest pytaniem. Karta „to follow up on"
→ „to chase up" ćwiczyłaby produkcję kolokwializmu, czyli dokładnie tego, za
co OET Writing obniża ocenę. Rejestr formalny zasługuje na własny tryb
(potocznie → formalnie), nie na odwrócenie tego istniejącego.

Karta nie powstaje też tam, gdzie wskazówka zawiera uczony termin
(`follow-up` jako opis dla `follow-up`) — pilnuje tego `findPhrase`.

### `NoteType` zostaje dwuwartościowy

Trzecia wartość byłaby niebezpieczna: notatka z nieznanym `noteType` otwarta
w starszym buildzie daje `CARDS_PER_NOTE_TYPE[nieznany] === undefined` →
`slice(undefined)` → `slice(0)` → **skasowanie wszystkich kart notatki razem
ze stanem FSRS**. Karta opisowa jest więc dodatkiem sterowanym osobno
(`setCueCard`), nie nowym typem notatki.

Konsekwencja: pętla uzgadniająca liczbę kart w `updateNote` pomija `ord 2`.
Bez tego karta opisowa znikałaby przy **każdej** edycji fiszki — to był realny
błąd, który ta zmiana naprawia (test „edycja fiszki NIE kasuje karty opisowej").

### Istnienie karty nie zależy od treści pola

Wyłączenie karty opisowej **odkłada** ją (`suspended`), nigdy nie kasuje.
Skasowana karta zabiera stan FSRS bezpowrotnie, a wyczyszczenie synonimów
w formularzu nie jest powodem do utraty tygodni powtórek.

### Karty opisowe włącza użytkownik, nie aktualizacja

Przycisk z licznikiem w Ustawieniach, nie automat. Dzienny limit nowych kart
się nie zmienia (kolejka i tak daje jedną kartę z notatki na sesję), ale
notatka rozkłada się na trzy dni zamiast dwóch — to przesuwa tempo przerobu
materiału o połowę i ostrzeżenie o dacie egzaminu. Cicha zmiana planu nauki
byłaby nadużyciem.

### `dataVersion` w stanie pakietu

Nowy kod potrafi wyciągnąć z tych samych plików więcej niż stary (zna pola
adnotacji). Odciski plików się nie zmieniają, więc zwykłe porównanie nie
wymusiłoby ponownego wprowadzenia. Stąd `BundledStateRecord.dataVersion`:
niezgodność oznacza „wszystkie pliki do wprowadzenia". Scalanie uzupełnia
i niczego nie dubluje, więc to jest tanie.

Jedna dziura zostaje: kopia zrobiona po aktualizacji i przywrócona na
urządzeniu ze starą powłoką przeniesie tam `dataVersion: 2`, a stary kod
zapisze znacznik bez wyciągnięcia nowych pól. Dlatego w Ustawieniach jest
**„Wprowadź pakiet ponownie"** — to wyjście awaryjne jest częścią planu,
nie ozdobą.

### Kopia zapasowa deklaruje wersję schematu

`parseBackup` do tej pory **w ogóle nie czytał** pola `schema`. Teraz: brak =
kopia sprzed wprowadzenia pola (1), wartość nieliczbowa = błąd, wartość
większa niż `DB_VERSION` = odmowa z wyjaśnieniem. Kopia z nowszej wersji może
zawierać sklepy i pola, których ta wersja nie zna; wczytanie jej po cichu
zgubiłoby dane.

Naprawa po przywróceniu kopii wykonuje się **poza** transakcją przywracania.
`restoreBackup` ma `catch` robiący `tx.abort()` — wyjątek z naprawy zamieniłby
udane przywrócenie w nieudane.

## Konsekwencje

- Pliki pakietu (`public/slownik/*.json`) **w tym wdrożeniu zostają sklejone**.
  Rozbija je naprawa po stronie aplikacji. Przebudowa plików i odmowa
  generatora manifestu przy sklejonym `example` to osobne wdrożenie.
- `phrase.ts` nadal filtruje wiersze `Synonimy:`/`Formalnie:` przy szukaniu
  zdania do luki. To przestaje być mechanizmem głównym, ale broni baz sprzed
  zmiany i baz przywróconych z kopii — **nie usuwać jako duplikatu**.
- Człony list rozdziela **ukośnik ze spacjami** (`a / b`). W pakiecie są człony
  z ukośnikiem w środku (`temporary/covering doctor`), które naiwne
  `split("/")` rozbiłoby na bezsensowne połówki.
- Nowe pola dopisujemy do `KNOWN_FIELDS` **zawsze na końcu**: ta kolejność
  wchodzi do porównań `JSON.stringify`, a przetasowanie dałoby fałszywe
  „zaktualizowano 229 fiszek" i fałszywe `editedAt`.
- `ReviewLogRecord.templateOrd` (opcjonalne) pozwoli sprawdzić, czy karty
  opisowe są trudniejsze od zwykłych. Bez tego pytanie byłoby nierozstrzygalne
  po fakcie.
