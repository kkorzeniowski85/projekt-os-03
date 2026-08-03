"""Format wlasny aplikacji - `fiszki/v1`.

To jest format docelowy: kazde inne zrodlo jest do niego sprowadzane. Jest
tez formatem, w ktorym najlatwiej dostarczyc gotowa talie z zewnatrz (np.
wygenerowana przez model jezykowy), bo nie wymaga zgadywania kolumn.

    {
      "format": "fiszki/v1",
      "deck": "Angielski B2",
      "default_note_type": "basic_reversed",
      "notes": [
        {
          "front": "ubiquitous",
          "back": "wszechobecny",
          "example": "Smartphones are ubiquitous these days.",
          "tags": ["b2", "przymiotnik"],
          "kind": "word",
          "note_type": "basic_reversed",
          "source_ref": "oxford-3000/ubiquitous"
        }
      ]
    }

Wymagane sa wylacznie `front` i `back`. Przyjmowana jest tez naga lista notatek
(bez koperty) - wtedy obowiazuja wartosci domyslne.
"""

import json
from typing import Any

from app.core.rendering import FIELD_BACK, FIELD_EXAMPLE, FIELD_FRONT
from app.importers.base import (
    TARGET_KIND,
    TARGET_TAGS,
    ImportError_,
    ParseResult,
    SourceRow,
)
from app.models import NoteType

FORMAT_ID = "fiszki/v1"

#: Klucz w JSON -> kolumna posrednia (nazwa widoczna pozniej w mapowaniu).
_KEYS = {
    "front": FIELD_FRONT,
    "back": FIELD_BACK,
    "example": FIELD_EXAMPLE,
    "tags": TARGET_TAGS,
    "kind": TARGET_KIND,
}


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value)
    return str(value)


def parse(data: bytes, options: dict | None = None) -> ParseResult:
    try:
        payload = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ImportError_(f"Nieprawidlowy JSON: {exc}") from exc

    warnings: list[str] = []

    if isinstance(payload, list):
        notes = payload
        deck_name = None
        default_note_type = NoteType.BASIC
        warnings.append("Plik bez koperty - przyjeto wartosci domyslne.")
    elif isinstance(payload, dict):
        declared = payload.get("format")
        if declared and declared != FORMAT_ID:
            warnings.append(f"Plik deklaruje format '{declared}', oczekiwano '{FORMAT_ID}'.")
        notes = payload.get("notes")
        if not isinstance(notes, list):
            raise ImportError_("Brak listy 'notes'.")
        deck_name = payload.get("deck")
        default_note_type = _note_type(payload.get("default_note_type"), warnings)
    else:
        raise ImportError_("Oczekiwano obiektu albo listy na najwyzszym poziomie.")

    rows: list[SourceRow] = []
    for index, note in enumerate(notes, start=1):
        if not isinstance(note, dict):
            warnings.append(f"Pozycja {index}: pominieta (nie jest obiektem).")
            continue

        values = {column: _as_text(note.get(key)) for key, column in _KEYS.items()}
        if not values[FIELD_FRONT].strip() or not values[FIELD_BACK].strip():
            warnings.append(f"Pozycja {index}: pominieta (pusty przod albo tyl).")
            continue

        tags = note.get("tags")
        rows.append(
            SourceRow(
                values=values,
                source_ref=_as_text(note.get("source_ref")) or None,
                source_deck=_as_text(note.get("deck")) or deck_name,
                tags=[str(t) for t in tags] if isinstance(tags, list) else [],
            )
        )

    if not rows:
        raise ImportError_("Plik nie zawiera zadnej kompletnej fiszki.")

    return ParseResult(
        source_format="fiszki-json",
        columns=list(_KEYS.values()),
        rows=rows,
        # Format kanoniczny nie wymaga zgadywania - kolumny sa juz docelowe.
        suggested_mapping={column: column for column in _KEYS.values()},
        warnings=warnings,
        source_decks=sorted({r.source_deck for r in rows if r.source_deck}),
        suggested_note_type=default_note_type,
    )


def _note_type(value: Any, warnings: list[str]) -> NoteType:
    if value is None:
        return NoteType.BASIC
    try:
        return NoteType(str(value))
    except ValueError:
        warnings.append(f"Nieznany typ notatki '{value}' - uzyto jednostronnego.")
        return NoteType.BASIC
