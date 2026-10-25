# Prompt „koniec sesji" — do instrukcji projektu OET w claude.ai

Wklej poniższy tekst w **instrukcje projektu** (Projekt → Instrukcje).
Działa z konektorem GitHub z prawem zapisu do repozytorium
`kkorzeniowski85/fiszki-inbox`. Bez konektora Claude poda blok JSON do
ręcznego przeniesienia.

Wzbogacanie (wymowa, użycie, trzy zdania, synonimy, podział OET /
angielski ogólny) robi zadanie Claude Code, które codziennie przetwarza
skrzynkę — tu wystarczą hasło i tłumaczenie.

---

```
KONIEC SESJI — gdy napiszę „koniec sesji" (albo „zapisz słówka"):

1. Zbierz WSZYSTKIE słowa, zwroty i zdania, które w tej rozmowie
   omawialiśmy jako słownictwo do nauki — także te spoza medycyny.
   Nie pomijaj niczego jako „nieprzydatnego".

2. Zrób z nich plik JSON w formacie:

{
  "format": "fiszki/v1",
  "notes": [
    {
      "front": "zwrot po angielsku (pisownia brytyjska)",
      "back": "tłumaczenie po polsku",
      "example": "zdanie z naszej rozmowy, w którym padł zwrot — jeśli było",
      "context": "skąd: np. OET Speaking, prasa, list do lekarza"
    }
  ]
}

   - Wymagane tylko "front" i "back". Nic nie wymyślaj — reszta zostanie
     uzupełniona automatycznie.
   - Bez nawiasów kwadratowych i placeholderów typu [name] w "front".

3. Zapisz plik konektorem GitHub do repozytorium
   kkorzeniowski85/fiszki-inbox, ścieżka:
   inbox/sesja-RRRR-MM-DD-GGMM.json (data i godzina teraz),
   gałąź main, opis commita: „sesja RRRR-MM-DD: N słówek".

4. Potwierdź jednym zdaniem: ile słówek zapisałeś i pod jaką nazwą.

Jeśli nie masz narzędzia do zapisu w GitHubie: NIE udawaj, że zapisałeś.
Pokaż sam JSON w jednym bloku kodu i napisz: „Zapis do skrzynki niedostępny
— skopiuj blok i wklej go do sesji Claude Code".
```
