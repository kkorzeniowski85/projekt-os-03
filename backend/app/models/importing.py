import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class ImportStatus(str, enum.Enum):
    ANALYZED = "analyzed"  # plik sparsowany, czeka na potwierdzenie mapowania
    COMMITTED = "committed"  # notatki utworzone
    CANCELLED = "cancelled"


class ImportJob(UUIDMixin, Base):
    """Import jest dwufazowy: najpierw analiza, potem zatwierdzenie.

    Powod: zaden zewnetrzny format nie mowi wprost, ktora kolumna jest przodem,
    ktora tylem, a ktora tagiem. Wrzucenie pliku prosto do bazy oznaczaloby
    zgadywanie i sprzatanie po pomylce. Faza analizy zwraca podglad i
    proponowane mapowanie, uzytkownik je poprawia, dopiero potem zapis.

    Sparsowane pozycje leza w `items` (JSONB) miedzy jedna faza a druga, wiec
    zatwierdzenie nie wymaga ponownego wysylania pliku.
    """

    __tablename__ = "import_jobs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: Talia docelowa. NULL w fazie analizy - wybierana przy zatwierdzaniu.
    deck_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decks.id", ondelete="SET NULL"), nullable=True
    )

    source_format: Mapped[str] = mapped_column(String(32), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[ImportStatus] = mapped_column(
        SAEnum(ImportStatus, name="import_status", values_callable=lambda e: [m.value for m in e]),
        default=ImportStatus.ANALYZED,
        nullable=False,
    )

    #: Wykryte kolumny/pola zrodla oraz ostrzezenia parsera.
    analysis: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    #: Mapowanie pole zrodlowe -> pole docelowe, zatwierdzone przez uzytkownika.
    mapping: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    #: Sparsowane pozycje w formacie kanonicznym (lista slownikow).
    items: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    total_items: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    imported_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
