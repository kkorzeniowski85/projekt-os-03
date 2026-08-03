import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db import get_db
from app.models import User
from app.schemas.stats import ForecastPoint, ItemKindStats, LeechCard, Overview, TagStats
from app.services import stats as service

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview", response_model=Overview)
def overview(
    deck_id: uuid.UUID | None = None,
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Overview:
    return Overview(**service.overview(db, user, deck_id, days))


@router.get("/by-item-kind", response_model=list[ItemKindStats])
def by_item_kind(
    deck_id: uuid.UUID | None = None,
    days: int = Query(default=90, ge=1, le=3650),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ItemKindStats]:
    """Skutecznosc osobno dla slow, fraz, wyrazen i zdan."""
    return [ItemKindStats(**row) for row in service.breakdown_by_item_kind(db, user, deck_id, days)]


@router.get("/by-tag", response_model=list[TagStats])
def by_tag(
    deck_id: uuid.UUID | None = None,
    days: int = Query(default=90, ge=1, le=3650),
    limit: int = Query(default=30, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TagStats]:
    return [TagStats(**row) for row in service.breakdown_by_tag(db, user, deck_id, days, limit)]


@router.get("/leeches", response_model=list[LeechCard])
def leeches(
    deck_id: uuid.UUID | None = None,
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LeechCard]:
    """Material, ktory uporczywie nie chce sie utrwalic."""
    return [LeechCard(**row) for row in service.leeches(db, user, deck_id, limit)]


@router.get("/forecast", response_model=list[ForecastPoint])
def forecast(
    deck_id: uuid.UUID | None = None,
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ForecastPoint]:
    """Ile kart wypada do powtorki w kolejnych dniach."""
    return [ForecastPoint(**row) for row in service.forecast(db, user, deck_id, days)]
