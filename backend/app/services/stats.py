"""Statystyki liczone z `review_log` - jedynego zrodla prawdy o nauce.

Nic tu nie jest przechowywane osobno ani cache'owane. Kazda liczba jest
zapytaniem po logu, wiec nie ma ryzyka, ze statystyka rozjedzie sie ze stanem
kart. Gdy log urosnie na tyle, ze zacznie to byc wolne, wchodzi tabela dziennych
agregatow - ale dopiero wtedy i tylko jako cache, nie jako zrodlo.

Kluczowa metryka to **rzeczywista skutecznosc** (true retention): odsetek
powtorek zaliczonych sposrod kart bedacych w stanie Review. Powtorek w trakcie
nauki (Learning/Relearning) do niej nie wliczamy - tam "Znowu" jest normalnym
krokiem, a nie porazka, wiec zanizaloby wynik.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import Float, Integer, and_, case, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Card, Deck, ItemKind, Note, ReviewLog, User

settings = get_settings()

#: Prog dojrzalosci karty w dniach. Karta o mniejszej stabilnosci jest "swieza"
#: - jej zapominanie znaczy co innego niz zapomnienie materialu utrwalonego.
MATURE_STABILITY_DAYS = 21.0

#: Od tylu wpadek karta trafia na liste problemow. Anki uzywa 8 i nie ma powodu
#: wymyslac wlasnej liczby, dopoki wlasne dane nie powiedza inaczej.
LEECH_LAPSES = 8

#: Ponizej tylu powtorek w grupie skutecznosc jest szumem, nie sygnalem.
MIN_REVIEWS_FOR_SIGNAL = 20

_ROLLOVER = timedelta(hours=settings.day_rollover_hour)

#: Powtorka karty juz nauczonej - tylko takie licza sie do skutecznosci.
_IS_REVIEW_STATE = ReviewLog.state_before["state"].astext.cast(Integer) == 2
_IS_SUCCESS = ReviewLog.rating > 1
_STABILITY_BEFORE = ReviewLog.state_before["stability"].astext.cast(Float)


def _study_day(column):
    """Data "dnia nauki" - z przesunieciem o godzine przelomu doby."""
    return func.date(column - _ROLLOVER)


def _retention(condition=None):
    """Wyrazenie liczace odsetek zaliczonych powtorek."""
    scope = _IS_REVIEW_STATE if condition is None else and_(_IS_REVIEW_STATE, condition)
    successes = func.count().filter(and_(scope, _IS_SUCCESS))
    total = func.count().filter(scope)
    return case((total > 0, successes.cast(Float) / total), else_=None)


def _scope(user: User, deck_id: uuid.UUID | None):
    conditions = [ReviewLog.user_id == user.id]
    if deck_id is not None:
        conditions.append(Card.deck_id == deck_id)
    return conditions


@dataclass
class Window:
    since: datetime
    days: int


def make_window(days: int) -> Window:
    now = datetime.now(timezone.utc)
    return Window(since=now - timedelta(days=days), days=days)


# --- przeglad --------------------------------------------------------------


def overview(db: Session, user: User, deck_id: uuid.UUID | None, days: int) -> dict:
    window = make_window(days)
    conditions = _scope(user, deck_id)

    base = select().select_from(ReviewLog).join(Card, Card.id == ReviewLog.card_id)

    totals = db.execute(
        base.add_columns(
            func.count().label("reviews"),
            func.count(func.distinct(ReviewLog.card_id)).label("cards_touched"),
            func.coalesce(func.sum(ReviewLog.review_duration_ms), 0).label("total_ms"),
            _retention().label("retention"),
            _retention(_STABILITY_BEFORE < MATURE_STABILITY_DAYS).label("retention_young"),
            _retention(_STABILITY_BEFORE >= MATURE_STABILITY_DAYS).label("retention_mature"),
            func.count().filter(_IS_REVIEW_STATE).label("mature_scope_reviews"),
        ).where(*conditions, ReviewLog.review_datetime >= window.since)
    ).one()

    all_time = db.execute(
        base.add_columns(func.count().label("reviews")).where(*conditions)
    ).one()

    daily = db.execute(
        base.add_columns(
            _study_day(ReviewLog.review_datetime).label("day"),
            func.count().label("reviews"),
            func.coalesce(func.sum(ReviewLog.review_duration_ms), 0).label("ms"),
            _retention().label("retention"),
        )
        .where(*conditions, ReviewLog.review_datetime >= window.since)
        .group_by(_study_day(ReviewLog.review_datetime))
        .order_by(_study_day(ReviewLog.review_datetime))
    ).all()

    ratings = db.execute(
        base.add_columns(ReviewLog.rating, func.count().label("count"))
        .where(*conditions, ReviewLog.review_datetime >= window.since)
        .group_by(ReviewLog.rating)
    ).all()

    return {
        "days": days,
        "reviews": totals.reviews,
        "reviews_all_time": all_time.reviews,
        "cards_touched": totals.cards_touched,
        "total_seconds": round((totals.total_ms or 0) / 1000),
        "seconds_per_review": round((totals.total_ms or 0) / 1000 / totals.reviews, 1)
        if totals.reviews
        else None,
        "retention": _round(totals.retention),
        "retention_young": _round(totals.retention_young),
        "retention_mature": _round(totals.retention_mature),
        # Bez tej liczby skutecznosc jest nieinterpretowalna - 100% z trzech
        # powtorek nie znaczy nic.
        "retention_sample": totals.mature_scope_reviews,
        "streak_days": _streak([row.day for row in daily]),
        "daily": [
            {
                "day": row.day.isoformat(),
                "reviews": row.reviews,
                "seconds": round((row.ms or 0) / 1000),
                "retention": _round(row.retention),
            }
            for row in daily
        ],
        "ratings": {str(row.rating): row.count for row in ratings},
    }


def _streak(days: list[date]) -> int:
    """Liczba kolejnych dni nauki liczac wstecz od dzis (albo wczoraj)."""
    if not days:
        return 0
    known = set(days)
    today = (datetime.now(timezone.utc) - _ROLLOVER).date()
    # Dzien jeszcze trwa, wiec brak powtorki dzis nie zeruje passy.
    cursor = today if today in known else today - timedelta(days=1)
    streak = 0
    while cursor in known:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


# --- podzial na kategorie ---------------------------------------------------


def breakdown_by_item_kind(
    db: Session, user: User, deck_id: uuid.UUID | None, days: int
) -> list[dict]:
    """Skutecznosc i obciazenie osobno dla slow, fraz, wyrazen i zdan.

    To jest podstawa decyzji, o ktore kategorie trzeba zadbac inaczej: jesli
    zdania maja skutecznosc 70%, a slowa 95%, to nie jest kwestia przypadku
    tylko sygnal, ze zdania wymagaja innego traktowania.
    """
    window = make_window(days)
    conditions = _scope(user, deck_id)

    reviews = db.execute(
        select(
            Note.item_kind.label("kind"),
            func.count().label("reviews"),
            _retention().label("retention"),
            func.count().filter(_IS_REVIEW_STATE).label("retention_sample"),
            func.avg(ReviewLog.review_duration_ms).label("avg_ms"),
        )
        .select_from(ReviewLog)
        .join(Card, Card.id == ReviewLog.card_id)
        .join(Note, Note.id == Card.note_id)
        .where(*conditions, ReviewLog.review_datetime >= window.since)
        .group_by(Note.item_kind)
    ).all()

    card_conditions = [Card.user_id == user.id, Card.deleted_at.is_(None)]
    if deck_id is not None:
        card_conditions.append(Card.deck_id == deck_id)

    cards = db.execute(
        select(
            Note.item_kind.label("kind"),
            func.count().label("cards"),
            func.count(func.distinct(Note.id)).label("notes"),
            func.avg(Card.stability).label("avg_stability"),
            func.avg(Card.difficulty).label("avg_difficulty"),
            func.coalesce(func.sum(Card.lapses), 0).label("lapses"),
            func.count().filter(Card.stability.is_(None)).label("new_cards"),
        )
        .select_from(Card)
        .join(Note, Note.id == Card.note_id)
        .where(*card_conditions)
        .group_by(Note.item_kind)
    ).all()

    by_kind = {row.kind: row for row in reviews}
    out = []
    for row in cards:
        stats = by_kind.get(row.kind)
        sample = stats.retention_sample if stats else 0
        out.append(
            {
                "item_kind": row.kind.value if isinstance(row.kind, ItemKind) else str(row.kind),
                "cards": row.cards,
                "notes": row.notes,
                "new_cards": row.new_cards,
                "reviews": stats.reviews if stats else 0,
                "retention": _round(stats.retention) if stats and sample >= MIN_REVIEWS_FOR_SIGNAL else None,
                "retention_sample": sample,
                "avg_stability_days": _round(row.avg_stability, 1),
                "avg_difficulty": _round(row.avg_difficulty, 2),
                "lapses": row.lapses,
                "seconds_per_review": _round((stats.avg_ms or 0) / 1000, 1) if stats else None,
            }
        )
    out.sort(key=lambda item: item["cards"], reverse=True)
    return out


def breakdown_by_tag(
    db: Session, user: User, deck_id: uuid.UUID | None, days: int, limit: int
) -> list[dict]:
    window = make_window(days)
    conditions = _scope(user, deck_id)

    # unnest musi isc przez podzapytanie - PostgreSQL nie pozwala grupowac po
    # funkcji zwracajacej zbior wprost w liscie select.
    tags = (
        select(Note.id.label("note_id"), func.unnest(Note.tags).label("tag"))
        .where(Note.user_id == user.id, Note.deleted_at.is_(None))
        .subquery()
    )

    rows = db.execute(
        select(
            tags.c.tag,
            func.count().label("reviews"),
            _retention().label("retention"),
            func.count().filter(_IS_REVIEW_STATE).label("retention_sample"),
            func.count(func.distinct(Card.id)).label("cards"),
        )
        .select_from(ReviewLog)
        .join(Card, Card.id == ReviewLog.card_id)
        .join(tags, tags.c.note_id == Card.note_id)
        .where(*conditions, ReviewLog.review_datetime >= window.since)
        .group_by(tags.c.tag)
        .order_by(func.count().desc())
        .limit(limit)
    ).all()

    return [
        {
            "tag": row.tag,
            "cards": row.cards,
            "reviews": row.reviews,
            "retention": _round(row.retention) if row.retention_sample >= MIN_REVIEWS_FOR_SIGNAL else None,
            "retention_sample": row.retention_sample,
        }
        for row in rows
    ]


# --- material problematyczny ------------------------------------------------


def leeches(db: Session, user: User, deck_id: uuid.UUID | None, limit: int) -> list[dict]:
    """Karty, ktore uporczywie nie chca sie utrwalic.

    Wysoka liczba wpadek przy niskiej stabilnosci zwykle nie znaczy, ze trzeba
    ich powtarzac wiecej - tylko ze fiszka jest zle sformulowana (za duzo tresci
    naraz, mylaca sie z inna, brak kontekstu).
    """
    conditions = [Card.user_id == user.id, Card.deleted_at.is_(None), Card.lapses > 0]
    if deck_id is not None:
        conditions.append(Card.deck_id == deck_id)

    rows = db.execute(
        select(
            Card.id,
            Card.lapses,
            Card.reps,
            Card.stability,
            Card.difficulty,
            Card.due,
            Note.id.label("note_id"),
            Note.fields,
            Note.item_kind,
            Deck.name.label("deck_name"),
        )
        .select_from(Card)
        .join(Note, Note.id == Card.note_id)
        .join(Deck, Deck.id == Card.deck_id)
        .where(*conditions)
        .order_by(Card.lapses.desc(), Card.stability.asc().nulls_last())
        .limit(limit)
    ).all()

    return [
        {
            "card_id": str(row.id),
            "note_id": str(row.note_id),
            "front": (row.fields or {}).get("Front", ""),
            "back": (row.fields or {}).get("Back", ""),
            "item_kind": row.item_kind.value if isinstance(row.item_kind, ItemKind) else str(row.item_kind),
            "deck_name": row.deck_name,
            "lapses": row.lapses,
            "reps": row.reps,
            "stability_days": _round(row.stability, 1),
            "difficulty": _round(row.difficulty, 2),
            "is_leech": row.lapses >= LEECH_LAPSES,
        }
        for row in rows
    ]


# --- prognoza obciazenia ----------------------------------------------------


def forecast(db: Session, user: User, deck_id: uuid.UUID | None, days: int) -> list[dict]:
    """Ile kart wypadnie do powtorki w kolejnych dniach.

    Sluzy do wylapania kumulacji zanim sie wydarzy - jesli za tydzien czeka 400
    kart, lepiej wiedziec o tym dzis.
    """
    conditions = [
        Card.user_id == user.id,
        Card.deleted_at.is_(None),
        Card.stability.is_not(None),
    ]
    if deck_id is not None:
        conditions.append(Card.deck_id == deck_id)

    horizon = datetime.now(timezone.utc) + timedelta(days=days)

    rows = db.execute(
        select(_study_day(Card.due).label("day"), func.count().label("count"))
        .where(*conditions, Card.due <= horizon)
        .group_by(_study_day(Card.due))
        .order_by(_study_day(Card.due))
    ).all()

    return [{"day": row.day.isoformat(), "count": row.count} for row in rows]


def _round(value, digits: int = 3):
    return None if value is None else round(float(value), digits)
