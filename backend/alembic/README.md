# Migracje

Katalog `versions/` jest celowo pusty. Pierwszą migrację generujesz sam,
z żywej bazy:

```bash
alembic revision --autogenerate -m "initial"
alembic upgrade head
```

Dlaczego nie dostarczam gotowej migracji: napisana ręcznie, bez uruchomienia
przeciwko Postgresowi, byłaby niezweryfikowana — a rozjazd między migracją
a modelami wychodzi wtedy dopiero przy `upgrade head`. Autogeneracja z modeli
daje gwarancję zgodności.

Kolejne zmiany schematu: ten sam `revision --autogenerate` + `upgrade head`.
**Zawsze przejrzyj wygenerowany plik przed uruchomieniem** — Alembic nie wykrywa
poprawnie zmian nazw kolumn (widzi je jako drop + add, czyli utratę danych).
