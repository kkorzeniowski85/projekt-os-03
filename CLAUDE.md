# Fiszki — zasady dla Claude

Aplikacja do nauki słownictwa przed egzaminem **OET** (Occupational English
Test, wersja dla lekarzy). Użytkownik jest lekarzem-radiologiem, uczy się na
telefonie (Galaxy S23). Local-first PWA (Next.js, IndexedDB, bez serwera),
hosting na GitHub Pages: każdy push na `main` buduje i wdraża aplikację.
Komunikujemy się **po polsku**.

## Bezpieczeństwo i prywatność

- Repozytorium jest **publiczne**. Zdania przykładowe muszą być wymyślone —
  nigdy dane prawdziwych pacjentów.
- Pracuj tylko w tym repozytorium (i w `fiszki-inbox`). Nie przeszukuj dysku
  użytkownika: jego folder „Mój dysk" zawiera materiał zawodowy i pacjencki.
- `talie/` to prywatne archiwum (w `.gitignore`) — nie publikuj go.

## Pakiet słówek (`frontend/public/slownik/`)

Treść jedzie z aplikacją: pliki w formacie `fiszki/v1` + `manifest.json`
(generowany). Telefon dociąga zmiany sam po otwarciu aplikacji. Szczegóły:
`docs/adr/0007-slownik-wbudowany.md`, `docs/adr/0008-…`,
`docs/format-fiszki-v1.md`.

### Gdzie dopisać nowe słowo

| Plik | Co | `source_ref` (kontynuuj numerację z pliku) |
|---|---|---|
| `oet-terminologia.json` | terminy medyczne, zwroty formalne do listu/raportu | `oet-terminy/mNN/slug` |
| `oet-nhs.json` | żargon szpitalny NHS, praca na oddziale | `oet-frazy/nNN/slug` |
| `oet-codziennosc.json` | brytyjski angielski potoczny przydatny w Speaking | `oet-frazy/lNN/slug` |
| `oet-rozmowa.json` | całe zdania do rozmowy z pacjentem | `oet-rozmowa/rNN/slug` |
| `oet-konsultacja.json` | zwroty prowadzenia konsultacji (Speaking) | `oet-konsultacja/kNN/slug` |
| `oet-skroty.json` | skróty z notatek klinicznych | `oet-skroty/skrot` |
| `oet-pisownia-uk.json` | pisownia brytyjska vs amerykańska | `oet-pisownia/pNN/slug` |
| `ogolny.json` | **słownictwo spoza OET** (prasa, codzienność, ogólny angielski) — talia „Angielski ogólny" | `ogolny/gNN/slug` |

- **Dodawaj wszystko, co użytkownik przyśle.** Nie odrzucaj słów jako
  „nieprzydatnych" — to, co nie przyda się na OET, idzie do `ogolny.json`.
- `source_ref` jest **stały na zawsze** — nigdy nie zmieniaj istniejącego.
  Telefon rozpoznaje po nim fiszkę (i jej postęp nauki).
- Przed dodaniem sprawdź duplikaty (po `front`, z pominięciem nawiasów
  i „to ") we **wszystkich** plikach. Duplikat pomiń i powiedz o tym.
- Zachowaj styl pliku: większość to `JSON.stringify(dane, null, 2)` + `\n`;
  `oet-rozmowa.json` (tagi w jednej linii) i `oet-skroty.json` (fiszka
  w jednej linii) mają własny styl — wstawiaj tekstowo, nie przepisuj pliku.

### Każda nowa fiszka musi mieć

- `front` (angielski), `back` (polski — możesz poprawić kalki, powiedz o tym)
- `example`: **3 zdania**, każde **zawiera uczony zwrot** (może być
  odmieniony), brytyjska pisownia, najlepiej kontekst kliniczny. Bez
  placeholderów (`[name]`, `[symptom]`) — zamień na konkret.
- `pronunciation`: IPA brytyjskie (RP) w ukośnikach. Konwencja: słabe formy
  `/tə/`, `/ðə/`, `/ə/`, `/əv/`; `ɡ` (U+0261), nie `g`; część frontu
  w nawiasie zwykle pomijana.
- `register` (pole „użycie"): `rejestr · częstość — wskazówka`.
  Rejestr: `potoczne` / `codzienne` / `formalne` / `fachowe` /
  `żargon szpitalny` / `skrót`. Częstość: `bardzo częste` / `częste` /
  `rzadkie`. Przy terminach fachowych wskazówka mówi, jak to powiedzieć
  pacjentowi (np. `fachowe · częste — z pacjentem: swelling`).
- `synonyms` (zalecane): wyrażenia **wymienne w zdaniu**, człony
  oddzielone ` / `. **Nie mogą zawierać samego hasła** — z nich powstaje
  karta „opis → termin".
- `tags`, `kind` (`word` / `phrase` / `expression` / `sentence`),
  `note_type`: `basic_reversed` (obie strony) dla słownictwa aktywnego,
  `basic` (tylko ang → pol) dla słów rzadkich, do rozpoznawania.
- Nie wklejaj wymowy, synonimów ani formy formalnej do `example` —
  generator manifestu odrzuci taki plik.

### Po zmianie pakietu (w `frontend/`)

```
npm run slownik        # manifest + walidacja plików
npm run sprawdz-nowe   # bramka jakości NOWYCH fiszek (zdania, luka, IPA, użycie, synonimy)
npm test
npm run lint
```

Wszystko musi przejść. Potem commit na `main` i push — wdrożenie rusza
samo (GitHub Actions). Commit po polsku, opisz co doszło.

### Prompty pod stare trackery

Użytkownik bywa, że wkleja materiał w formacie trackerów z claude.ai
(`oet-medical-vocabulary-v2`: term/polish/context/synonyms/examples;
`oet-vocabulary-phrases-v4`: chunk/polish/register/formal/examples).
Trackerów nie ma w repo. Mapowanie: term/chunk → `front`, polish → `back`,
examples → `example`. Pole `formal` z trackera to zwykle parafrazy —
wtedy idzie do `synonyms`, nie `formal`.

## Skrzynka (`kkorzeniowski85/fiszki-inbox`)

Prywatne repozytorium, do którego trafiają słówka z sesji w claude.ai
(prompt: `docs/prompt-koniec-sesji.md`). Codziennie przetwarza je
zaplanowane zadanie Claude Code w chmurze. Gdy przetwarzasz skrzynkę:

1. Weź pliki z `inbox/` (dowolny format: fiszki/v1, JSON trackera, CSV,
   zwykła lista). Pusta skrzynka = koniec, bez commitów.
2. Każdy plik przetwórz według zasad powyżej (duplikaty, OET czy
   `ogolny.json`, 3 zdania, IPA, użycie, synonimy), uruchom wszystkie
   cztery polecenia z sekcji „Po zmianie pakietu", commit i push
   w `projekt-os-03`.
3. W `fiszki-inbox`: przenieś plik do `przetworzone/RRRR-MM-DD/` i dopisz
   obok krótki raport `.md` po polsku: co dodano i gdzie, co pominięto
   (duplikaty) i co zmieniono względem źródła (np. poprawione tłumaczenie).
   Commit i push.
4. Pliku, którego nie da się przetworzyć, nie ruszaj z `inbox/` — opisz
   problem w `bledy/RRRR-MM-DD.md`.
