import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class User(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Ustawienia FSRS per uzytkownik. fsrs_parameters=None oznacza wagi domyslne
    # biblioteki; wlasne wagi pojawia sie dopiero po optymalizacji na historii.
    desired_retention: Mapped[float] = mapped_column(Float, default=0.9, nullable=False)
    fsrs_parameters: Mapped[list[float] | None] = mapped_column(JSONB, nullable=True)


class RefreshToken(UUIDMixin, Base):
    """Refresh tokeny trzymamy zahaszowane i rotujemy przy kazdym uzyciu.

    Dzieki temu wyciek bazy nie daje dostepu do kont, a ponowne uzycie zuzytego
    tokenu jest wykrywalne.
    """

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
