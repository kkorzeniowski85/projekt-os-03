import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.decks import get_owned_deck
from app.config import get_settings
from app.core import scheduler as fsrs
from app.core.rendering import example, render
from app.core.security import get_current_user
from app.db import get_db
from app.models import Card, Deck, ReviewLog, User
from app.schemas.study import ReviewIn, ReviewOut, StudyCard, StudyQueue

router = APIRouter(prefix="/study", tags=["study"])
settings = get_settings()


def day_start(now: datetime) -> datetime:
    """Poczatek biezacego "dnia nauki".

    Granica o 4:00 (a nie o polnocy), bo nauka po polnocy powinna liczyc sie do
    dnia poprzedniego. Liczone w UTC - dla uzytkownika w innej strefie granica
    wypadnie w innej porze. Patrz docs/adr/0003.
    """
    start = now.replace(hour=settings.day_rollover_hour, minute=0, second=0, microsecond=0)
    if now < start:
        start -= timedelta(days=1)
    return start


def _counters(db: Session, user: User, deck: Deck, since: datetime) -> tuple[int, int]:
    """(nowe karty wprowadzone dzis, wszystkie powtorki dzis) w danej talii."""
    base = (
        select(func.count(func.distinct(ReviewLog.card_id)))
        .join(Card, Card.id == ReviewLog.card_id)
        .where(
            ReviewLog.user_id == user.id,
            Card.deck_id == deck.id,
            ReviewLog.review_datetime >= since,
        )
    )
    # Karta byla nowa, jesli w chwili powtorki nie miala jeszcze stability.
    new_today = db.scalar(base.where(ReviewLog.state_before["stability"].astext.is_(None))) or 0
    reviews_today = (
        db.scalar(
            select(func.count())
            .select_from(ReviewLog)
            .join(Card, Card.id == ReviewLog.card_id)
            .where(
                ReviewLog.user_id == user.id,
                Card.deck_id == deck.id,
                ReviewLog.review_datetime >= since,
            )
        )
        or 0
    )
    return new_today, reviews_today


def _to_study_card(card: Card, user: User, now: datetime) -> StudyCard:
    question, answer = render(card.note, card.template_ord)
    return StudyCard(
        card_id=card.id,
        note_id=card.note_id,
        deck_id=card.deck_id,
        question=question,
        answer=answer,
        example=example(card.note),
        template_label=card.template_label,
        tags=list(card.note.tags or []),
        state=card.state,
        is_new=card.is_new,
        due=card.due,
        interval_preview=fsrs.preview_intervals(card, user, now),
    )


@router.get("/queue", response_model=StudyQueue)
def queue(
    deck_id: uuid.UUID,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StudyQueue:
    deck = get_owned_deck(deck_id, db, user)
    now = datetime.now(timezone.utc)
    new_today, reviews_today = _counters(db, user, deck, day_start(now))

    new_allowance = max(deck.new_per_day - new_today, 0)
    review_allowance = max(deck.max_reviews_per_day - reviews_today, 0)

    owned = [Card.user_id == user.id, Card.deck_id == deck.id, Card.deleted_at.is_(None)]

    # Zalegle: karta byla juz widziana (stability != NULL) i termin minal.
    due_cards = list(
        db.scalars(
            select(Card)
            .where(*owned, Card.stability.is_not(None), Card.due <= now)
            .order_by(Card.due)
            .limit(min(limit, review_allowance))
        )
    )

    # Nowe: nigdy nie widziane, w kolejnosci dodania.
    remaining_slots = max(limit - len(due_cards), 0)
    new_cards = list(
        db.scalars(
            select(Card)
            .where(*owned, Card.stability.is_(None))
            .order_by(Card.created_at)
            .limit(min(remaining_slots, new_allowance))
        )
    )

    total_due = (
        db.scalar(
            select(func.count())
            .select_from(Card)
            .where(*owned, Card.stability.is_not(None), Card.due <= now)
        )
        or 0
    )
    total_new = (
        db.scalar(
            select(func.count()).select_from(Card).where(*owned, Card.stability.is_(None))
        )
        or 0
    )

    cards = due_cards + new_cards
    return StudyQueue(
        deck_id=deck.id,
        cards=[_to_study_card(c, user, now) for c in cards],
        new_remaining=min(total_new, new_allowance),
        due_remaining=min(total_due, review_allowance),
    )


@router.post("/review", response_model=ReviewOut)
def submit_review(
    payload: ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReviewOut:
    card = db.scalar(
        select(Card).where(
            Card.id == payload.card_id,
            Card.user_id == user.id,
            Card.deleted_at.is_(None),
        )
    )
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nie znaleziono karty")

    # Idempotencja: ten sam client_event_id to ponowienie, nie nowa powtorka.
    existing = db.scalar(
        select(ReviewLog).where(
            ReviewLog.user_id == user.id,
            ReviewLog.client_event_id == payload.client_event_id,
        )
    )
    if existing is not None:
        return _review_out(card, duplicate=True)

    now = datetime.now(timezone.utc)
    reviewed_at = payload.reviewed_at or now
    if reviewed_at.tzinfo is None:
        reviewed_at = reviewed_at.replace(tzinfo=timezone.utc)

    if reviewed_at > now + timedelta(minutes=5):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Data powtorki jest w przyszlosci")
    if card.last_review is not None and reviewed_at < card.last_review:
        # Powtorki wsteczne wymagaja odtworzenia logu; to czesc modelu sync,
        # ktorego jeszcze nie ma. Lepiej odmowic niz cicho zepsuc stan karty.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Powtorka jest starsza niz ostatnia zapisana - obsluga zdarzen wstecznych wejdzie razem z synchronizacja",
        )

    state_before, state_after = fsrs.review(
        card,
        user,
        rating=payload.rating,
        review_datetime=reviewed_at,
        review_duration_ms=payload.duration_ms,
    )

    db.add(
        ReviewLog(
            user_id=user.id,
            card_id=card.id,
            client_event_id=payload.client_event_id,
            rating=payload.rating,
            review_datetime=reviewed_at,
            review_duration_ms=payload.duration_ms,
            state_before=state_before,
            state_after=state_after,
            scheduler_version=fsrs.scheduler_version(user),
        )
    )
    db.commit()
    db.refresh(card)
    return _review_out(card)


def _review_out(card: Card, duplicate: bool = False) -> ReviewOut:
    return ReviewOut(
        card_id=card.id,
        state=card.state,
        due=card.due,
        scheduled_label=fsrs.humanize_interval(card.due - datetime.now(timezone.utc)),
        reps=card.reps,
        lapses=card.lapses,
        duplicate=duplicate,
    )
