"""Rejestr importerow i wykrywanie formatu.

Dodanie nowego zrodla = jeden modul z funkcja `parse(data: bytes) -> ParseResult`
plus wpis w FORMATS. Reszta sciezki (mapowanie, deduplikacja, zapis) jest wspolna.
"""

from dataclasses import dataclass
from typing import Callable

from app.importers import anki, canonical, plaintext, tabular
from app.importers.base import (
    MAPPING_TARGETS,
    TARGET_IGNORE,
    TARGET_KIND,
    TARGET_TAGS,
    ImportError_,
    ParseResult,
    SourceRow,
    cap_warnings,
    content_hash,
    guess_item_kind,
    is_known_header,
    looks_like_html,
    parse_item_kind,
    suggest_mapping,
    to_plain_text,
)


@dataclass(frozen=True)
class Format:
    key: str
    label: str
    extensions: tuple[str, ...]
    #: parse(data, options) -> ParseResult. `options` sa specyficzne dla formatu
    #: (np. has_header dla CSV) i moga byc ignorowane.
    parse: Callable[..., ParseResult]
    description: str


FORMATS: tuple[Format, ...] = (
    Format(
        key="fiszki-json",
        label="Format wlasny (fiszki/v1)",
        extensions=(".json",),
        parse=canonical.parse,
        description="Format docelowy aplikacji. Nie wymaga mapowania kolumn.",
    ),
    Format(
        key="anki",
        label="Anki (.apkg / .colpkg)",
        extensions=(".apkg", ".colpkg"),
        parse=anki.parse,
        description="Talia lub kolekcja z Anki. Bez mediow i bez stanu powtorek.",
    ),
    Format(
        key="csv",
        label="CSV / TSV",
        extensions=(".csv", ".tsv"),
        parse=tabular.parse,
        description="Arkusze, eksport z Quizletu i wiekszosci kursow.",
    ),
    Format(
        key="text",
        label="Zwykly tekst",
        extensions=(".txt", ".md"),
        parse=plaintext.parse,
        description="Jedna fiszka na linie, np. 'kot - cat'.",
    ),
)

_BY_KEY = {fmt.key: fmt for fmt in FORMATS}


def get_format(key: str) -> Format:
    if key not in _BY_KEY:
        raise ImportError_(f"Nieznany format '{key}'.")
    return _BY_KEY[key]


def detect_format(filename: str, data: bytes) -> Format:
    """Rozpoznaje format po zawartosci, a rozszerzenie traktuje jako podpowiedz.

    Zawartosc ma pierwszenstwo: plik nazwany .txt bywa CSV-em, a .json bywa
    naga lista notatek.
    """
    if data[:4] == b"PK\x03\x04":
        return _BY_KEY["anki"]

    head = data[:2048].lstrip()
    if head[:1] in (b"{", b"["):
        return _BY_KEY["fiszki-json"]

    lowered = filename.lower()
    for fmt in FORMATS:
        if any(lowered.endswith(ext) for ext in fmt.extensions):
            return fmt

    # Bez rozstrzygajacego rozszerzenia: separator kolumn decyduje, czy to
    # tabela, czy lista linii.
    sample = data[:4096].decode("utf-8", errors="ignore")
    if sample.count(",") + sample.count(";") + sample.count("\t") >= max(sample.count("\n"), 1):
        return _BY_KEY["csv"]
    return _BY_KEY["text"]


def parse(
    filename: str,
    data: bytes,
    format_key: str | None = None,
    options: dict | None = None,
) -> ParseResult:
    fmt = get_format(format_key) if format_key else detect_format(filename, data)
    return fmt.parse(data, options)


__all__ = [
    "FORMATS",
    "Format",
    "ImportError_",
    "MAPPING_TARGETS",
    "ParseResult",
    "SourceRow",
    "TARGET_IGNORE",
    "TARGET_KIND",
    "TARGET_TAGS",
    "cap_warnings",
    "content_hash",
    "detect_format",
    "get_format",
    "guess_item_kind",
    "is_known_header",
    "looks_like_html",
    "to_plain_text",
    "parse",
    "parse_item_kind",
    "suggest_mapping",
]
