"""Normalizacja zaimportowanych danych do formatu aplikacji i zapis do bazy.

Tu konczy sie roznorodnosc zrodel: wejsciem jest ParseResult z dowolnego
importera plus mapowanie kolumn, wyjsciem zawsze ta sama struktura notatki.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.rendering import FIELD_BACK, FIELD_EXAMPLE, FIELD_FRONT, KNOWN_FIELDS
from app.importers import (
    TARGET_KIND,
    TARGET_TAGS,
    ParseResult,
    content_hash,
    guess_item_kind,
    parse_item_kind,
)
from app.models import Deck, ItemKind, Note, NoteType, User
from app.services.notes import sync_cards

#: Ile znormalizowanych pozycji wraca w podgladzie fazy analizy.
PREVIEW_SIZE = 10


@dataclass
class CommitStats:
    imported: int
    skipped_duplicates: int
    skipped_invalid: int


def _split_tags(raw: str) -> list[str]:
    separators = [",", ";"]
    value = raw or ""
    for sep in separators[1:]:
        value = value.replace(sep, separators[0])
    return [tag.strip() for tag in value.split(separators[0]) if tag.strip()]


def normalize(
    result: ParseResult,
    mapping: dict[str, str],
    *,
    default_kind: ItemKind | None = None,
) -> list[dict]:
    """Zamienia wiersze zrodla na notatki w formacie aplikacji.

    `default_kind=None` oznacza zgadywanie kategorii z tresci przodu. Jawna
    wartosc wygrywa z heurystyka, ale przegrywa z kolumna zrodla zmapowana
    na `kind` - zrodlo wie lepiej niz nasze domyslne ustawienie.
    """
    drafts: list[dict] = []

    for row in result.rows:
        fields: dict[str, str] = {}
        tags = list(row.tags)
        kind: ItemKind | None = None

        for column, target in mapping.items():
            value = (row.values.get(column) or "").strip()
            if not value:
                continue
            if target in KNOWN_FIELDS:
                fields[target] = value
            elif target == TARGET_TAGS:
                tags.extend(_split_tags(value))
            elif target == TARGET_KIND:
                kind = parse_item_kind(value)

        front = fields.get(FIELD_FRONT, "").strip()
        back = fields.get(FIELD_BACK, "").strip()
        if not front or not back:
            continue

        if kind is None:
            kind = default_kind or guess_item_kind(front)

        # Kolejnosc kluczy ustalona, zeby te same dane dawaly identyczny JSONB.
        clean = {name: fields[name] for name in KNOWN_FIELDS if fields.get(name)}

        drafts.append(
            {
                "fields": clean,
                "tags": sorted({t for t in tags if t}),
                "item_kind": kind.value,
                "source_ref": row.source_ref,
                "source_deck": row.source_deck,
                # None = typ wybrany przy imporcie. Zrodlo moze go nadpisac
                # dla pojedynczej pozycji (patrz SourceRow.note_type).
                "note_type": row.note_type.value if row.note_type else None,
                "content_hash": content_hash(clean),
            }
        )

    return drafts


def _resolve_note_type(from_source: str | None, fallback: NoteType) -> NoteType:
    """Typ ze zrodla wygrywa z typem wybranym przy imporcie.

    Talia bywa mieszana: pojedyncze slowo warto pytac w obie strony, calego
    zdania juz nie. Jeden typ narzucony na caly plik oznaczalby albo bezuzyteczne
    karty wsteczne przy zdaniach, albo brak kierunku produkcji przy slowach.
    """
    if not from_source:
        return fallback
    try:
        return NoteType(from_source)
    except ValueError:
        return fallback


def preview(drafts: list[dict]) -> list[dict]:
    return drafts[:PREVIEW_SIZE]


def duplicate_summary(db: Session, user: User, drafts: list[dict]) -> dict:
    """Ile pozycji juz jest w bazie i ile powtarza sie w samym pliku."""
    hashes = [d["content_hash"] for d in drafts]
    unique = set(hashes)

    existing: set[str] = set()
    if unique:
        # IN z kilkoma tysiacami wartosci potrafi przekroczyc limit parametrow
        # sterownika, wiec pytamy porcjami.
        values = list(unique)
        for start in range(0, len(values), 1000):
            chunk = values[start : start + 1000]
            existing.update(
                db.scalars(
                    select(Note.content_hash).where(
                        Note.user_id == user.id,
                        Note.deleted_at.is_(None),
                        Note.content_hash.in_(chunk),
                    )
                )
            )

    return {
        "total": len(drafts),
        "unique": len(unique),
        "duplicates_in_file": len(hashes) - len(unique),
        "already_in_collection": len(existing),
    }


def commit(
    db: Session,
    user: User,
    deck: Deck,
    drafts: list[dict],
    *,
    note_type: NoteType,
    skip_duplicates: bool = True,
) -> CommitStats:
    """Tworzy notatki i karty. Nie commituje sesji - robi to warstwa API."""
    existing: set[str] = set(
        db.scalars(
            select(Note.content_hash).where(
                Note.user_id == user.id, Note.deleted_at.is_(None)
            )
        )
    )
    existing.discard(None)  # type: ignore[arg-type]

    imported = 0
    skipped_duplicates = 0
    skipped_invalid = 0
    seen_in_batch: set[str] = set()

    for draft in drafts:
        fields = draft.get("fields") or {}
        if not fields.get(FIELD_FRONT) or not fields.get(FIELD_BACK):
            skipped_invalid += 1
            continue

        digest = draft.get("content_hash") or content_hash(fields)
        if skip_duplicates and (digest in existing or digest in seen_in_batch):
            skipped_duplicates += 1
            continue
        seen_in_batch.add(digest)

        try:
            kind = ItemKind(draft.get("item_kind") or ItemKind.OTHER.value)
        except ValueError:
            kind = ItemKind.OTHER

        note = Note(
            user_id=user.id,
            deck_id=deck.id,
            note_type=_resolve_note_type(draft.get("note_type"), note_type),
            fields={k: v for k, v in fields.items() if k in KNOWN_FIELDS},
            tags=list(draft.get("tags") or []),
            item_kind=kind,
            source_ref=draft.get("source_ref"),
            content_hash=digest,
        )
        db.add(note)
        db.flush()
        sync_cards(db, note)
        imported += 1

    return CommitStats(
        imported=imported,
        skipped_duplicates=skipped_duplicates,
        skipped_invalid=skipped_invalid,
    )


def as_json_id(value: uuid.UUID | None) -> str | None:
    return str(value) if value else None


__all__ = [
    "CommitStats",
    "FIELD_BACK",
    "FIELD_EXAMPLE",
    "FIELD_FRONT",
    "PREVIEW_SIZE",
    "commit",
    "duplicate_summary",
    "normalize",
    "preview",
]
