import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.decks import get_owned_deck
from app.core.rendering import FIELD_FRONT
from app.core.security import get_current_user
from app.importers import content_hash, guess_item_kind
from app.db import get_db
from app.models import Note, User
from app.models.base import utcnow
from app.schemas.note import CardOut, NoteCreate, NoteListOut, NoteOut, NoteUpdate
from app.services.notes import sync_cards

router = APIRouter(prefix="/notes", tags=["notes"])


def get_owned_note(note_id: uuid.UUID, db: Session, user: User) -> Note:
    note = db.scalar(
        select(Note).where(
            Note.id == note_id, Note.user_id == user.id, Note.deleted_at.is_(None)
        )
    )
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nie znaleziono notatki")
    return note


def to_out(note: Note) -> NoteOut:
    out = NoteOut.model_validate(note)
    # Karty skasowane miekko nie sa czescia biezacego stanu notatki.
    alive = sorted((c for c in note.cards if c.deleted_at is None), key=lambda c: c.template_ord)
    out.cards = [CardOut.model_validate(c) for c in alive]
    return out


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NoteOut:
    deck = get_owned_deck(payload.deck_id, db, user)
    note = Note(
        user_id=user.id,
        deck_id=deck.id,
        note_type=payload.note_type,
        fields=payload.fields,
        tags=payload.tags,
        item_kind=payload.item_kind or guess_item_kind(payload.fields.get(FIELD_FRONT, "")),
        content_hash=content_hash(payload.fields),
    )
    db.add(note)
    db.flush()
    sync_cards(db, note)
    db.commit()
    db.refresh(note)
    return to_out(note)


@router.get("", response_model=NoteListOut)
def list_notes(
    deck_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, description="Szuka w polach notatki"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NoteListOut:
    conditions = [Note.user_id == user.id, Note.deleted_at.is_(None)]
    if deck_id is not None:
        conditions.append(Note.deck_id == deck_id)
    if q:
        pattern = f"%{q}%"
        conditions.append(
            or_(
                Note.fields["Front"].astext.ilike(pattern),
                Note.fields["Back"].astext.ilike(pattern),
            )
        )

    total = db.scalar(select(func.count()).select_from(Note).where(*conditions)) or 0
    notes = list(
        db.scalars(
            select(Note)
            .where(*conditions)
            .order_by(Note.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return NoteListOut(items=[to_out(n) for n in notes], total=total)


@router.get("/{note_id}", response_model=NoteOut)
def get_note(
    note_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NoteOut:
    return to_out(get_owned_note(note_id, db, user))


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: uuid.UUID,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NoteOut:
    note = get_owned_note(note_id, db, user)
    data = payload.model_dump(exclude_unset=True)

    if "deck_id" in data and data["deck_id"] is not None:
        get_owned_deck(data["deck_id"], db, user)

    for key, value in data.items():
        if value is not None:
            setattr(note, key, value)

    if "fields" in data and data["fields"] is not None:
        # Hash musi nadazac za trescia, inaczej deduplikacja przy imporcie
        # przestaje widziec te fiszke.
        note.content_hash = content_hash(note.fields)
        if "item_kind" not in data:
            note.item_kind = guess_item_kind(note.fields.get(FIELD_FRONT, ""))

    db.flush()
    sync_cards(db, note)
    db.commit()
    db.refresh(note)
    return to_out(note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    note = get_owned_note(note_id, db, user)
    now = utcnow()
    note.deleted_at = now
    for card in note.cards:
        if card.deleted_at is None:
            card.deleted_at = now
    db.commit()
