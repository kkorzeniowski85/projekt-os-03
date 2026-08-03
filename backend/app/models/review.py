import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, SmallInteger, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class ReviewLog(UUIDMixin, Base):
    """Append-only log powtorek. Nigdy nie modyfikowany, nigdy nie kasowany.

    To jest zrodlo prawdy dla stanu kart. Kolumny w `cards` sa materializowanym
    wynikiem odtworzenia tego logu - dzieki temu dwie sesje nauki wykonane
    offline na roznych urzadzeniach da sie scalic (posortowac po
    review_datetime i odtworzyc), zamiast pozwolic jednej nadpisac druga.

    Warunkiem jest deterministyczny scheduler - dlatego fuzzing FSRS jest
    wylaczony. Patrz app/core/scheduler.py i docs/adr/0002.
    """

    __tablename__ = "review_log"
    __table_args__ = (
        # Idempotencja syncu: urzadzenie generuje client_event_id lokalnie,
        # wiec ponowne wyslanie tej samej powtorki nie zdubluje jej w logu.
        UniqueConstraint("user_id", "client_event_id", name="uq_review_log_client_event"),
        Index("ix_review_log_card_time", "card_id", "review_datetime"),
        Index("ix_review_log_user_time", "user_id", "review_datetime"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False
    )
    client_event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 1=Again 2=Hard 3=Good 4=Easy
    review_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    #: NOT NULL celowo. fsrs.Optimizer.compute_optimal_retention() odmawia
    #: pracy, jesli choc jedna powtorka nie ma zmierzonego czasu - a wymaga ich
    #: 512. Pojedynczy brak psuje optymalizacje dla calego konta, i to
    #: bezpowrotnie, bo czasu nie da sie odtworzyc wstecz.
    review_duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    #: Pelny stan karty przed i po - pozwala audytowac i odtworzyc bez replayu.
    state_before: Mapped[dict] = mapped_column(JSONB, nullable=False)
    state_after: Mapped[dict] = mapped_column(JSONB, nullable=False)

    #: np. "fsrs-6.3.1/default" - zeby wiedziec, ktora wersja algorytmu i wag
    #: wyprodukowala dany wpis, gdy w przyszlosci zmienimy parametry.
    scheduler_version: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
