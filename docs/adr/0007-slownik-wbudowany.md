# 0007 — Słownik wbudowany: treść jedzie z aplikacją, postęp zostaje w telefonie

Data: 2026-09-19. Status: obowiązuje. Uzupełnia ADR 0006 — nie uchyla go.

## Kontekst

Po przejściu na local-first (ADR 0006) każde urządzenie ma własną kopię danych
i nic ich nie łączy. Dla postępu nauki to była świadoma decyzja. Dla treści
okazała się kosztem: każde nowe słówko przygotowane na komputerze trzeba było
ręcznie przenieść na telefon przez ekran Import, a poprawka tłumaczenia
w istniejącej fiszce wymagała ręcznej edycji na każdym urządzeniu osobno.
Użytkownik poprosił, żeby słówka aktualizowały się „razem z update aplikacji"
i żeby w ustawieniach był do tego przycisk.

Serwera nadal nie ma i nie będzie (ADR 0006). Jest natomiast jedna droga, którą
treść już dociera na każde urządzenie: nowa wersja aplikacji jako pliki
statyczne na GitHub Pages.

## Decyzja

Treść Słownika jest **częścią aplikacji** — pakietem plików statycznych — a każde
urządzenie **dowozi sobie różnicę** przy otwarciu.

- **Pakiet**: `frontend/public/slownik/*.json` w formacie fiszki/v1 plus
  `manifest.json` (lista plików z odciskami SHA-256), generowany automatycznie
  przed `build` i `dev` (`scripts/slownik-manifest.mjs`). O manifeście nie
  trzeba pamiętać; skrypt odmawia, gdy pozycja nie ma `source_ref` albo ta sama
  treść jest w dwóch plikach.
- **Dostawa**: po otwarciu aplikacji z dostępem do sieci (raz na załadowanie
  strony) i na żądanie z ekranu Ustawienia aplikacja pobiera manifest
  (`cache: no-store`; service worker tej ścieżki nie przechwytuje), porównuje
  odciski z zapamiętanymi i wprowadza **tylko zmienione pliki**. Plik o odcisku
  niezgodnym z manifestem jest pomijany i zostaje „do wprowadzenia" na następny
  raz.
- **Scalanie jest autorytatywne, ale nie ślepe** (`commitImport` z opcją
  `authoritative`):
  - fiszkę odnajduje po odcisku treści **albo po `source_ref`** — poprawka
    tłumaczenia zmienia odcisk, a ma trafić w tę samą fiszkę, nie utworzyć
    drugiej obok; karty i stan FSRS zostają
  - fiszki poprawionej ręcznie (`NoteRecord.editedAt`, ustawiane przez „Edytuj")
    **nie nadpisuje** — dopisuje tylko brakujące pola i tagi. Ręka użytkownika
    wygrywa z repozytorium
  - **nigdy nie kasuje** — plik usunięty z pakietu zostawia swoje fiszki
- **Fiszka skasowana ręcznie nie wraca**: `deleteNote` zapisuje jej odcisk
  i `source_ref` w stanie pakietu, a dostawa takie pozycje pomija. Kasowanie
  całej talii śladu nie zostawia — to porządkowanie, nie sąd o pojedynczej
  fiszce.
- **Stan pakietu** (`settings/slownik-wbudowany`) żyje obok ustawień: jeden
  mały rekord, który nie zasłużył na własny sklep i migrację schematu. Wchodzi
  do kopii zapasowej razem z resztą.

## Czym to NIE jest

Nie jest synchronizacją. Postęp nauki, historia powtórek i własne fiszki nadal
istnieją wyłącznie na urządzeniu (ADR 0006). Treść płynie w jedną stronę:
repozytorium → urządzenia. Przeniesienie postępu na inne urządzenie to nadal
kopia zapasowa.

## Konsekwencje

- Nowe słówko dodaje się jednym ruchem: plik do `public/slownik/`, commit,
  push. Każde urządzenie dostanie je przy następnym otwarciu. Ekran Import
  zostaje dla materiału jednorazowego.
- Pliki pakietu są **publiczne** — repozytorium jest publiczne, bo GitHub Pages
  tego wymaga. Do pakietu trafia tylko materiał, który może być jawny;
  `talie/` pozostaje poza repozytorium.
- `source_ref` staje się tożsamością fiszki między wersjami pakietu: raz nadany
  nie zmienia się nigdy.
- Ten sam plik wgrany wcześniej ręcznie przez Import nie dubluje się z pakietem
  — rozpoznaje go odcisk treści (pilnuje tego test).
- Service worker (v4) wyłącza `slownik/` z pamięci podręcznej. Bez tego
  przycisk pokazywałby stan sprzed jednego otwarcia.

## Uzupełnienie (2026-10-25): druga talia pakietu — „Angielski ogólny"

Na prośbę użytkownika słownictwo spoza OET (prasa, codzienność: *anxious*,
*egregious*, *depravity*…) ma osobne miejsce. Plik pakietu deklaruje talię
docelową polem koperty `"bundle_deck": "ogolny"`; generator przenosi je do
manifestu jako `deck`, a `applyBundled` importuje plik do talii o stałym id
`ogolny`, tworzonej przy pierwszej dostawie.

- **Poza egzaminem.** Kolejka „wszystko" (Ucz się ze wszystkich talii,
  szybka sesja) i tempo przed egzaminem pomijają tę talię — uczy się jej
  własnym przyciskiem. Zaznaczona ręcznie wchodzi normalnie.
- **Przenoszenie ze stanem nauki.** Commit importu odnajduje fiszkę po
  `sourceRef` w całej bazie i aktualizuje ją tam, gdzie stoi; po nim
  `przeniesZPakietu` przesuwa notatkę, karty i wpisy logu do talii pliku.
  Rusza tylko fiszki z talii pakietu — przeniesione ręcznie do własnej talii
  zostają.
- **Chroniona jak Słownik.** Nie da się jej skasować ani wchłonąć (odtworzy
  ją dopiero zmiana pliku), a usunięta z niej fiszka zostaje zapamiętana
  jako odrzucona, tak jak w Słowniku.
- Manifest bez pola `deck` (albo z nieznaną wartością) = Słownik — stare
  wersje aplikacji pole ignorują.
