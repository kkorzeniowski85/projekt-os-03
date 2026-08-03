# ADR 0001 — Stack i struktura repozytorium

**Status:** zaakceptowany
**Data:** 2026-08-03

## Kontekst

Aplikacja do fiszek z powtórkami dla jednego użytkownika + kilku osób z rodziny.
Wymagania: przeglądarka, telefon, desktop, synchronizacja, pełna kontrola nad
danymi (własny backend).

## Decyzje

| Warstwa | Wybór | Wersja |
|---|---|---|
| Frontend | Next.js (App Router) jako PWA | 16.2.12 |
| UI | React + Tailwind CSS | 19.2.4 / 4.x |
| Backend | FastAPI | 0.115+ |
| ORM / migracje | SQLAlchemy 2.0 + Alembic | — |
| Baza | PostgreSQL | 17 |
| Algorytm powtórek | py-fsrs | 6.3.1 |
| Auth | JWT access + rotowany refresh w ciasteczku httpOnly | — |
| Hasła | argon2id (`argon2-cffi`) | — |

Monorepo: `backend/`, `frontend/`, `docs/`.

## Zmiany wobec pierwotnego planu

**Brak katalogu `shared/` z ręcznie pisanymi typami TS.** FastAPI wystawia
OpenAPI; typy dla frontendu generujemy z niego (`npm run gen:api`). Ręczna
synchronizacja typów w dwóch miejscach zawsze się rozjeżdża. Do czasu pierwszej
generacji typy są spisane ręcznie w `frontend/src/lib/types.ts` — jest ich mało.

**PyJWT zamiast python-jose.** Lepiej utrzymywany, mniejsza powierzchnia.

**Brak `@tanstack/react-query` w MVP.** Planowałem ją dodać, ale przy czterech
ekranach zwykły `fetch` w `useEffect` jest krótszy i ma mniej ruchomych części.
React Query zarobi na siebie dopiero przy offline i synchronizacji — wtedy
wejdzie.

**Brak `ts-fsrs` na froncie.** Planowanie robi wyłącznie backend, żeby istniało
jedno źródło prawdy. Front dostaje gotowe terminy i podgląd interwałów. `ts-fsrs`
będzie potrzebny dopiero, gdy ocenianie ma działać offline.

## PWA na iOS — weryfikacja przed inwestycją

Sprawdzone ograniczenia i wnioski:

- **Web Push** działa od iOS 16.4, ale tylko dla aplikacji dodanej do ekranu
  głównego i po jawnej zgodzie. Z poziomu karty Safari — nie.
- **IndexedDB** działa; 7-dniowe czyszczenie storage przez ITP nie dotyczy
  aplikacji z ekranu głównego, ale system może usunąć dane przy braku miejsca.
- **Background Sync** nie istnieje — synchronizacja tylko przy otwartej apce.
- **Instalacja** wymaga ręcznego „Udostępnij → Dodaj do ekranu głównego"; nie ma
  promptu instalacji jak na Androidzie.

**Wniosek:** ograniczenia są akceptowalne. Przypomnienia o powtórkach zrobimy
**mailem z backendu**, nie web pushem — to wyjmuje iOS z krytycznej ścieżki
i działa też na desktopie. IndexedDB pozostaje cache'em, nie źródłem prawdy
(zgodnie z ADR 0002).

*Do potwierdzenia na realnym iPhonie przed uznaniem tematu za zamknięty.*

## Desktop

Tauri lub Electron jako opakowanie tego samego kodu webowego — decyzja odłożona
do momentu, gdy PWA będzie działać. Nic w obecnym kodzie tego nie przesądza.

## Zakres importu

Potwierdzony: `.apkg` (Anki) + CSV. Parser `.apkg` powstanie **po stronie
backendu w Pythonie** — `.apkg` to ZIP z bazą SQLite, a nowsze eksporty (v3)
używają zstd i protobuf. W Pythonie mamy `sqlite3` i `zstandard`; w przeglądarce
byłoby to niepotrzebnie trudne.

Schemat `notes` → `cards` jest podyktowany właśnie importem: Anki ma ten sam
model, więc mapowanie jest 1:1 i bezstratne.
