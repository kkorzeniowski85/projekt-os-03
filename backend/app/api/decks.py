import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db import get_db
from app.models import Card, Deck, Note, User
from app.models.base import utcnow
from app.schemas.deck import DeckCounts, DeckCreate, DeckOut, DeckUpdate

router = APIRouter(prefix="/decks", tags=["decks"])


def get_owned_deck(deck_id: uuid.UUID, db: Session, user: User) -> Deck:
    deck = db.scalar(
        select(Deck).where(
            Deck.id == deck_id, Deck.user_id == user.id, Deck.deleted_at.is_(None)
        )
    )
    if deck is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nie znaleziono talii")
    return deck


def counts_for(db: Session, user: User, deck_ids: list[uuid.UUID]) -> dict[uuid.UUID, DeckCounts]:
    """Liczniki nowych/zaleglych kart dla podanych talii - jednym zapytaniem."""
    if not deck_ids:
        return {}
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(
            Card.deck_id,
            func.count().label("total"),
            func.count().filter(Card.stability.is_(None)).label("new"),
            func.count()
            .filter(Card.stability.is_not(None), Card.due <= now)
            .label("due"),
        )
        .where(
            Card.user_id == user.id,
            Card.deck_id.in_(deck_ids),
            Card.deleted_at.is_(None),
        )
        .group_by(Card.deck_id)
    ).all()
    found = {r.deck_id: DeckCounts(new=r.new, due=r.due, total=r.total) for r in rows}
    return {d: found.get(d, DeckCounts(new=0, due=0, total=0)) for d in deck_ids}


def to_out(deck: Deck, counts: DeckCounts | None) -> DeckOut:
    out = DeckOut.model_validate(deck)
    out.counts = counts
    return out


@router.get("", response_model=list[DeckOut])
def list_decks(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[DeckOut]:
    decks = list(
        db.scalars(
            select(Deck)
            .where(Deck.user_id == user.id, Deck.deleted_at.is_(None))
            .order_by(Deck.name)
        )
    )
    counts = counts_for(db, user, [d.id for d in decks])
    return [to_out(d, counts.get(d.id)) for d in decks]


@router.post("", response_model=DeckOut, status_code=status.HTTP_201_CREATED)
def create_deck(
    payload: DeckCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeckOut:
    deck = Deck(user_id=user.id, **payload.model_dump())
    db.add(deck)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Talia o tej nazwie juz istnieje")
    return to_out(deck, DeckCounts(new=0, due=0, total=0))


@router.get("/{deck_id}", response_model=DeckOut)
def get_deck(
    deck_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeckOut:
    deck = get_owned_deck(deck_id, db, user)
    return to_out(deck, counts_for(db, user, [deck.id])[deck.id])


@router.patch("/{deck_id}", response_model=DeckOut)
def update_deck(
    deck_id: uuid.UUID,
    payload: DeckUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeckOut:
    deck = get_owned_deck(deck_id, db, user)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(deck, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Talia o tej nazwie juz istnieje")
    return to_out(deck, counts_for(db, user, [deck.id])[deck.id])


@router.delete("/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_deck(
    deck_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    deck = get_owned_deck(deck_id, db, user)
    now = utcnow()
    # Kasowanie miekkie i kaskadowe "recznie" - historia powtorek (review_log)
    # zostaje nietknieta, bo to append-only log.
    deck.deleted_at = now
    for note in db.scalars(
        select(Note).where(Note.deck_id == deck.id, Note.deleted_at.is_(None))
    ):
        note.deleted_at = now
    for card in db.scalars(
        select(Card).where(Card.deck_id == deck.id, Card.deleted_at.is_(None))
    ):
        card.deleted_at = now
    db.commit()
