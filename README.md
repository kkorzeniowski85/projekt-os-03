# Fiszki

Aplikacja do fiszek z powtórkami rozłożonymi w czasie (FSRS). Monorepo:

```
backend/    FastAPI + SQLAlchemy + Alembic + py-fsrs
frontend/   Next.js (App Router) jako PWA
docs/adr/   decyzje architektoniczne
```

## 📱 Aplikacja działa: **[kkorzeniowski85.github.io/projekt-os-03](https://kkorzeniowski85.github.io/projekt-os-03/)**

Otwórz ten adres w Chrome na telefonie → menu ⋮ → **„Dodaj do ekranu głównego"**.
Aplikacja instaluje się jak zwykła, działa bez zasięgu, a nowe wersje wchodzą
same po każdym wdrożeniu.

Stan: **wersja local-first gotowa** ([ADR 0006](docs/adr/0006-local-first-bez-synchronizacji.md))
— całość działa w przeglądarce urządzenia: bez serwera, bez kont, bez
synchronizacji. Talie, nauka, import (fiszki/v1, CSV/TSV, zwykły tekst),
statystyki i kopia zapasowa (IndexedDB + ts-fsrs, FSRS-6). Backend FastAPI
pozostaje w repozytorium jako źródło portowanej logiki — nie wymaga
uruchamiania i nie jest częścią działającej aplikacji.

### Słownik — baza główna

Aplikacja ma jedną nienaruszalną bazę: **Słownik**. Istnieje od pierwszego
otwarcia, nie da się go usunąć ani „scalić w nicość" — kasować można wyłącznie
pojedyncze fiszki. Import trafia do niego domyślnie: wgrany plik **rozpływa się
w bazie** zamiast tworzyć osobną grupę (nazwa talii z pliku jest tylko
podpowiedzią przy świadomym wyborze „+ osobna talia"). Istniejące talie można
wchłonąć do Słownika przez łączenie — z pełną historią nauki.

### Dodawanie z telefonu

> **Czat Claude nie zna formatu tej aplikacji** — to osobne środowisko,
> bez dostępu do repozytorium i bez pamięci o projekcie. Na ekranie **Import**
> jest przycisk **„Skopiuj instrukcję dla Claude'a"**: wklej ją w rozmowie
> razem ze zdjęciem lub listą słówek, a wynik wróci gotowy do importu.
> Instrukcja jest wbudowana w aplikację, więc działa też bez zasięgu.

Trzy drogi, od najszybszej:

- **Udostępnij** — w dowolnej aplikacji (np. Claude po wygenerowaniu fiszek)
  wybierz *Udostępnij → Fiszki*: treść ląduje od razu w ekranie Import,
  przeanalizowana, z celem ustawionym na Słownik. Wymaga zainstalowanej
  aplikacji (Android/Chrome); przy większych partiach (setki fiszek) użyj
  wklejenia. Nowa opcja pojawia się w menu po ponownym otwarciu aplikacji.
- **+ Dodaj fiszkę** na liście talii — formularz Słownika, dla pojedynczych
  słówek w biegu.
- **Import → wklej treść** — dowolna ilość, dowolny format (fiszki/v1,
  CSV/TSV, tekst `słowo - tłumaczenie`).

### Nauka z wielu talii

Na liście talii można **zaznaczyć**, z których chce się materiał — albo nie
zaznaczać nic i uczyć się ze wszystkiego. Karty przeplatają się między taliami
(nie idą blokami), a **dzienne limity zostają przy swoich taliach**, więc jedna
nie zjada przydziału nowych kart innej.

Zaznaczone talie można też **trwale połączyć** w jedną. Stan powtórek każdej
karty i cała historia nauki przechodzą razem z materiałem. Operacja jest
nieodwracalna inaczej niż z kopii zapasowej — duplikaty treści są zliczane,
ale nigdy nie usuwane automatycznie.

> **Dane żyją tylko w tej przeglądarce.** Zanim wejdzie prawdziwa nauka, zrób
> kopię (Ustawienia → Pobierz kopię) i trzymaj ją poza urządzeniem.

---

## Uruchomienie

### 1. Baza danych

Wybierz jedną ścieżkę.

**A. Docker** (zalecane — ten sam obraz pojedzie na VPS):

```bash
docker compose up -d db
```

**B. Postgres zainstalowany natywnie** — utwórz bazę i użytkownika, a potem
podmień `DATABASE_URL` w `backend/.env`:

```sql
CREATE USER fiszki WITH PASSWORD 'fiszki';
CREATE DATABASE fiszki OWNER fiszki;
```

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
copy .env.example .env
```

Otwórz `backend/.env` i ustaw `JWT_SECRET` oraz `INVITE_CODE`. Sekret
wygenerujesz tak:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Pierwsza migracja (katalog `alembic/versions/` jest celowo pusty — patrz
`backend/alembic/README.md`):

```bash
alembic revision --autogenerate -m "initial"
alembic upgrade head
```

Start:

```bash
uvicorn app.main:app --reload --port 8000
```

Dokumentacja API: <http://localhost:8000/docs>

### 3. Frontend

```bash
cd frontend
npm install
copy .env.local.example .env.local
npm run dev
```

Aplikacja: <http://localhost:3000>

### 4. Sprawdzenie, że wszystko działa

Warstwa lokalna (docelowa — IndexedDB + ts-fsrs):

```bash
cd frontend && npm test
```

Testy backendu (importery, scheduler) nie potrzebują bazy:

```bash
cd backend && python -m pytest -q
```

Pełny cykl, przy uruchomionym backendzie:

```bash
python backend/scripts/smoke_e2e.py
```

Skrypt przechodzi ścieżkę rejestracja → talia → fiszka dwustronna → kolejka →
ocena → idempotencja → import CSV → deduplikacja → statystyki i wypisuje, co
zaplanował FSRS. Kończy się `SMOKE E2E OK`.

W przeglądarce: zarejestruj się (potrzebny `INVITE_CODE` z `backend/.env`),
dodaj fiszkę, kliknij „Ucz się".

---

## Co już działa

**Nauka**
- Rejestracja na kod zaproszenia, JWT z rotowanym refresh tokenem w ciasteczku
  httpOnly, hasła na argon2id, rate limiting na `/auth/*`
- Talie z licznikami, notatki → karty (jednostronna = 1 karta, dwustronna = 2,
  każda z własnym stanem FSRS)
- Ekran nauki: podgląd interwałów na przyciskach ocen, skróty (spacja / 1–4),
  idempotentne wysyłanie ocen
- Planowanie FSRS 6.3.1 z pełnym, deterministycznym logiem powtórek

**Import** — [ADR 0004](docs/adr/0004-import-wieloformatowy.md)
- Formaty: `fiszki/v1` (własny), Anki `.apkg`/`.colpkg`, CSV/TSV, zwykły tekst
- Dwufazowy: analiza z podglądem i mapowaniem kolumn → dopiero potem zapis
- Deduplikacja po odcisku treści, odporna na różnice formatowania i źródła
- Automatyczne rozpoznawanie kategorii materiału (słowo / fraza / zdanie)

**Statystyki** — [ADR 0005](docs/adr/0005-statystyki-i-decyzje.md)
- Rzeczywista skuteczność (bez zaniżania przez kroki nauki), z podziałem na
  materiał świeży i utrwalony, zawsze z liczebnością próbki
- **Rozbicie na kategorie: słowa / frazy / wyrażenia / zdania**
- Rozbicie na tagi, materiał do przeformułowania, prognoza obciążenia

**PWA**: manifest, ikony, service worker (na razie tylko powłoka aplikacji).

## Czego świadomie nie ma

Synchronizacja między urządzeniami · offline · media w fiszkach · optymalizacja
parametrów FSRS na własnej historii · role i uprawnienia · natywne aplikacje
mobilne.

Uproszczenia są spisane w [docs/adr/0003-znane-uproszczenia.md](docs/adr/0003-znane-uproszczenia.md)
— warto tam zajrzeć przed zgłoszeniem czegoś jako błąd.

## Dokumentacja

- [Format `fiszki/v1`](docs/format-fiszki-v1.md) — **specyfikacja formatu
  własnego**; w tym formacie najwygodniej zamawiać gotowe talie
- [0001 — Stack i struktura](docs/adr/0001-stack-i-struktura.md) — wybory
  technologii, weryfikacja ograniczeń PWA na iOS
- [0002 — Synchronizacja i konflikty](docs/adr/0002-synchronizacja-i-konflikty.md)
  — **przeczytaj przed dotknięciem synchronizacji**
- [0003 — Znane uproszczenia](docs/adr/0003-znane-uproszczenia.md)
- [0004 — Import wieloformatowy](docs/adr/0004-import-wieloformatowy.md)
- [0005 — Statystyki i decyzje o powtórkach](docs/adr/0005-statystyki-i-decyzje.md)
- [0006 — Local-first bez synchronizacji](docs/adr/0006-local-first-bez-synchronizacji.md)
  — **obowiązujący kierunek**; unieważnia założenie ADR 0002

## Następne kroki (migracja local-first, wg ADR 0006)

1. ~~Przepięcie ekranów (talie, nauka, notatki) na dane lokalne~~ ✓
2. ~~Import w przeglądarce: fiszki/v1, CSV/TSV, tekst~~ ✓ (Anki `.apkg` później)
3. ~~Statystyki liczone lokalnie~~ ✓
4. ~~Kopia zapasowa do pliku i przywracanie~~ ✓ (ekran **Ustawienia**)
5. ~~Hosting statyczny + instalacja na telefonie~~ ✓

Migracja zakończona. Dalej: Anki `.apkg` w przeglądarce (wymaga SQLite/WASM)
i optymalizacja parametrów FSRS na własnej historii (po ~512 powtórkach).
