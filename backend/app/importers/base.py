"""Wspolny kontrakt wszystkich importerow.

Kazdy format zewnetrzny sprowadzamy do tej samej postaci posredniej:
lista wierszy (slownik: nazwa kolumny zrodlowej -> wartosc) plus lista wykrytych
kolumn. Dopiero mapowanie (kolumna zrodlowa -> pole aplikacji) zamienia to na
notatki. Dzieki temu dolozenie nowego formatu to jedna funkcja parsujaca,
a nie kolejna sciezka zapisu do bazy.
"""

import hashlib
import html
import re
import unicodedata
from dataclasses import dataclass, field

from app.core.rendering import FIELD_BACK, FIELD_EXAMPLE, FIELD_FRONT
from app.models import ItemKind, NoteType

#: Cele mapowania: pola aplikacji + role specjalne.
TARGET_IGNORE = "ignore"
TARGET_TAGS = "tags"
TARGET_KIND = "kind"
MAPPING_TARGETS = (
    FIELD_FRONT,
    FIELD_BACK,
    FIELD_EXAMPLE,
    TARGET_TAGS,
    TARGET_KIND,
    TARGET_IGNORE,
)


@dataclass
class SourceRow:
    """Jeden wiersz zrodla, jeszcze przed mapowaniem."""

    values: dict[str, str]
    #: Identyfikator w zrodle (np. note id z Anki) - do ponownego importu.
    source_ref: str | None = None
    #: Talia w zrodle. Anki trzyma w jednym pliku wiele talii.
    source_deck: str | None = None
    #: Tagi, ktore zrodlo podaje wprost (Anki), poza mapowaniem kolumn.
    tags: list[str] = field(default_factory=list)
    #: Typ notatki narzucony przez zrodlo dla tej jednej pozycji.
    #: Ma znaczenie przy talii mieszanej: pojedyncze slowo warto pytac w obie
    #: strony, calego zdania juz nie. None = uzyj typu wybranego przy imporcie.
    note_type: NoteType | None = None


@dataclass
class ParseResult:
    source_format: str
    columns: list[str]
    rows: list[SourceRow]
    suggested_mapping: dict[str, str]
    warnings: list[str] = field(default_factory=list)
    source_decks: list[str] = field(default_factory=list)
    #: Typ notatki zasugerowany przez zrodlo (format kanoniczny moze go podac).
    suggested_note_type: NoteType = NoteType.BASIC


class ImportError_(Exception):
    """Blad, ktory da sie pokazac uzytkownikowi wprost."""


#: Ile ostrzezen ma sens pokazac. Przy imporcie calej kolekcji wadliwych pozycji
#: moga byc tysiace, a lista tej dlugosci i tak jest nie do przeczytania - za to
#: potrafi rozdac odpowiedz API i wpis w bazie.
WARNING_LIMIT = 50


def cap_warnings(warnings: list[str], limit: int = WARNING_LIMIT) -> list[str]:
    if len(warnings) <= limit:
        return warnings
    hidden = len(warnings) - limit
    return warnings[:limit] + [f"…i jeszcze {hidden} podobnych ostrzezen."]


# --- tekst z HTML ----------------------------------------------------------
#
# Eksporty fiszek prawie zawsze niosa HTML: Anki trzyma tak pola z definicji,
# a arkusze i eksporty z kursow potrafia miec w komorkach cale <div style=...>.
# Ekran nauki renderuje tresc doslownie, wiec znacznik zostawiony w polu widac
# jako smiec - i wchodzi jeszcze do odcisku tresci, wiec ta sama fiszka raz
# z HTML-em, raz bez, przestaje byc rozpoznawana jako duplikat.

_SOUND = re.compile(r"\[sound:[^\]]*\]", re.IGNORECASE)
_BREAK = re.compile(r"<\s*(br|/div|/p|/li|/tr)\s*/?\s*>", re.IGNORECASE)
_ANY_TAG = re.compile(r"<[^>]+>")

#: Znaczniki, ktore uznajemy za dowod, ze to naprawde HTML.
_REAL_TAG = re.compile(
    r"</?(?:br|div|p|span|b|i|u|em|strong|li|ul|ol|table|tr|td|th|font|a|img"
    r"|h[1-6]|hr|sub|sup|code|pre|blockquote)\b[^>]*>",
    re.IGNORECASE,
)


def looks_like_html(value: str) -> bool:
    """Czy wartosc ma prawdziwe znaczniki, czy tylko ostre nawiasy.

    Wymagamy nazwy znanego znacznika, bo komorka "a < b" HTML-em nie jest,
    a potraktowana jak HTML stracilaby polowe tresci. Ten sam wybor co przy
    wykrywaniu naglowka: przy watpliwosci nie ruszamy danych.
    """
    return bool(_REAL_TAG.search(value or ""))


def to_plain_text(raw: str) -> str:
    """Sprowadza pole w HTML do czystego tekstu, zachowujac podzial na linie."""
    without_sound = _SOUND.sub("", raw or "")
    with_newlines = _BREAK.sub("\n", without_sound)
    plain = html.unescape(_ANY_TAG.sub("", with_newlines))
    # Anki lubi twarde spacje; zostawione zafalszowalyby porownania i hashe.
    lines = [line.strip() for line in plain.replace("\xa0", " ").splitlines()]
    return "\n".join(line for line in lines if line).strip()


# --- sugerowanie mapowania -------------------------------------------------

#: Nazwy kolumn spotykane w praktyce (Quizlet, Anki, arkusze, eksporty kursow).
_HINTS: dict[str, tuple[str, ...]] = {
    FIELD_FRONT: (
        "front", "przod", "przód", "term", "termin", "word", "slowo", "słowo",
        "question", "pytanie", "source", "zrodlo", "źródło", "obcy", "foreign",
        "expression", "wyrazenie", "wyrażenie", "haslo", "hasło", "a", "1",
    ),
    FIELD_BACK: (
        "back", "tyl", "tył", "definition", "definicja", "answer", "odpowiedz",
        "odpowiedź", "translation", "tlumaczenie", "tłumaczenie", "meaning",
        "znaczenie", "target", "polski", "polish", "b", "2",
    ),
    FIELD_EXAMPLE: (
        "example", "przyklad", "przykład", "sentence", "zdanie", "usage",
        "uzycie", "użycie", "context", "kontekst",
    ),
    TARGET_TAGS: ("tags", "tagi", "tag", "kategoria", "category", "labels", "etykiety"),
    TARGET_KIND: ("kind", "rodzaj", "typ", "type", "item_kind"),
}


def _normalize_header(name: str) -> str:
    stripped = unicodedata.normalize("NFKD", name.strip().lower())
    return re.sub(r"[^a-z0-9ąćęłńóśźż]+", "", stripped)


_KNOWN_HEADERS = {_normalize_header(h) for hints in _HINTS.values() for h in hints}


def is_known_header(name: str) -> bool:
    """Czy tekst wyglada na nazwe kolumny, a nie na tresc fiszki."""
    return _normalize_header(name) in _KNOWN_HEADERS


def suggest_mapping(columns: list[str]) -> dict[str, str]:
    """Zgaduje mapowanie po nazwach kolumn, z fallbackiem na kolejnosc.

    Zgadywanie jest zawsze do poprawienia przez uzytkownika - to sugestia,
    nie decyzja.
    """
    mapping: dict[str, str] = {}
    taken: set[str] = set()

    for column in columns:
        normalized = _normalize_header(column)
        for target, hints in _HINTS.items():
            if target in taken:
                continue
            if normalized in {_normalize_header(h) for h in hints}:
                mapping[column] = target
                taken.add(target)
                break

    # Kolumny bez trafienia: pierwsze dwie wolne dostaja przod i tyl, bo w
    # praktyce prawie kazdy eksport ma je w tej kolejnosci.
    for column in columns:
        if column in mapping:
            continue
        if FIELD_FRONT not in taken:
            mapping[column] = FIELD_FRONT
            taken.add(FIELD_FRONT)
        elif FIELD_BACK not in taken:
            mapping[column] = FIELD_BACK
            taken.add(FIELD_BACK)
        else:
            mapping[column] = TARGET_IGNORE

    return mapping


# --- kategoria materialu ---------------------------------------------------

_SENTENCE_END = re.compile(r"[.!?…]\s*$")
_TOKEN = re.compile(r"[^\s]+")


def guess_item_kind(text: str) -> ItemKind:
    """Zgaduje, czy to slowo, fraza czy zdanie.

    EXPRESSION (idiom, zwrot staly) celowo nie jest zgadywane - heurystyka nie
    odroznia go od zwyklej frazy, a bledna etykieta zafalszowalaby statystyki
    bardziej niz jej brak. Ustawia sie je recznie albo mapuje z kolumny zrodla.
    """
    stripped = (text or "").strip()
    if not stripped:
        return ItemKind.OTHER

    tokens = _TOKEN.findall(stripped)
    if _SENTENCE_END.search(stripped) or len(tokens) >= 5:
        return ItemKind.SENTENCE
    if len(tokens) == 1:
        return ItemKind.WORD
    return ItemKind.PHRASE


def parse_item_kind(value: str) -> ItemKind | None:
    candidate = (value or "").strip().lower()
    aliases = {
        "slowo": ItemKind.WORD, "słowo": ItemKind.WORD, "word": ItemKind.WORD,
        "fraza": ItemKind.PHRASE, "phrase": ItemKind.PHRASE,
        "wyrazenie": ItemKind.EXPRESSION, "wyrażenie": ItemKind.EXPRESSION,
        "expression": ItemKind.EXPRESSION, "idiom": ItemKind.EXPRESSION,
        "zdanie": ItemKind.SENTENCE, "sentence": ItemKind.SENTENCE,
    }
    if candidate in aliases:
        return aliases[candidate]
    try:
        return ItemKind(candidate)
    except ValueError:
        return None


# --- deduplikacja ----------------------------------------------------------


def content_hash(fields: dict[str, str]) -> str:
    """Odcisk tresci odporny na roznice formatowania.

    Ta sama fiszka wyeksportowana raz z Anki, raz do CSV rozni sie bialymi
    znakami i wielkoscia liter - a to ten sam material, wiec ma dac ten sam hash.
    Przyklad nie wchodzi do hasha: dopisanie zdania przykladowego nie czyni
    fiszki nowa.
    """
    parts = []
    for name in (FIELD_FRONT, FIELD_BACK):
        value = " ".join((fields.get(name) or "").split()).casefold()
        parts.append(value)
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()
