import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UUIDMixin:
    """Klucze glowne jako UUID, nie sekwencje.

    Powod: przy synchronizacji urzadzenie offline musi umiec nadac id lokalnie,
    zanim zobaczy serwer. Sekwencje by to uniemozliwily.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )
    # updated_at ustawiamy po stronie Pythona (nie server_onupdate), bo przy
    # syncu to pole bedzie pochodzic z klienta i sluzy za podstawe LWW.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
        nullable=False,
    )


class SoftDeleteMixin:
    """Kasowanie jest miekkie - inaczej rekord usuniety na telefonie 'odzywa'
    po syncu z laptopa, ktory o usunieciu nie wie. Patrz docs/adr/0002.
    """

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
