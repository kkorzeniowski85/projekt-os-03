import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDMixin, utcnow


class ItemKind(str, enum.Enum):
    """Rodzaj materialu, ktorego dotyczy notatka.

    Istnieje po to, zeby statystyki i decyzje o powtorkach dalo sie prowadzic
    osobno dla slow, fraz, wyrazen i zdan - te kategorie zachowuja sie inaczej
    (pojedyncze slowo utrwala sie szybciej niz cale zdanie, wiec usrednianie
    ich razem zaciemnia obraz).

    Kategorie WORD / PHRASE / SENTENCE potrafi zgadnac heurystyka przy imporcie.
    EXPRESSION (idiom, zwrot staly) wymaga decyzji czlowieka - heurystyka nie
    odroznia go od zwyklej frazy.
    """

    WORD = "word"
    PHRASE = "phrase"
    EXPRESSION = "expression"
    SENTENCE = "sentence"
    OTHER = "other"


class NoteType(str, enum.Enum):
    """Typy notatek w MVP sa wbudowane, nie konfigurowalne przez uzytkownika.

    BASIC          -> 1 karta  (Front -> Back)
    BASIC_REVERSED -> 2 karty  (Front -> Back oraz Back -> Front)
    """

    BASIC = "basic"
    BASIC_REVERSED = "basic_reversed"


#: Ile kart generuje dany typ notatki.
CARDS_PER_NOTE_TYPE: dict[NoteType, int] = {
    NoteType.BASIC: 1,
    NoteType.BASIC_REVERSED: 2,
}


class Deck(UUIDMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "decks"
    __table_args__ = (
        # Unikalnosc tylko wsrod zywych talii - inaczej nie da sie utworzyc
        # talii o nazwie, ktora kiedys istniala i zostala skasowana.
        Index(
            "uq_decks_user_name_alive",
            "user_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)

    new_per_day: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    max_reviews_per_day: Mapped[int] = mapped_column(Integer, default=200, nullable=False)


class Note(UUIDMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Notatka = fakt. Karty to konkretne kierunki pytania o ten fakt.

    Rozdzial notatka/karta jest po to, zeby (a) edycja tresci w jednym miejscu
    aktualizowala wszystkie kierunki, (b) import z Anki mapowal sie 1:1.
    """

    __tablename__ = "notes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    deck_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    note_type: Mapped[NoteType] = mapped_column(
        SAEnum(NoteType, name="note_type", values_callable=lambda e: [m.value for m in e]),
        default=NoteType.BASIC,
        nullable=False,
    )
    #: {"Front": "...", "Back": "..."} - JSONB, zeby dodanie pol nie wymagalo migracji.
    fields: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, nullable=False)

    item_kind: Mapped[ItemKind] = mapped_column(
        SAEnum(ItemKind, name="item_kind", values_callable=lambda e: [m.value for m in e]),
        default=ItemKind.OTHER,
        nullable=False,
        index=True,
    )

    #: Identyfikator z zewnetrznego zrodla (np. note id z Anki) - do deduplikacji
    #: przy ponownym imporcie tej samej talii.
    source_ref: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)

    #: sha256 znormalizowanej tresci - wykrywa duplikaty przy imporcie z roznych
    #: zrodel, gdzie source_ref sie nie zgadza (ta sama fiszka z CSV i z .apkg).
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    cards: Mapped[list["Card"]] = relationship(
        back_populates="note", cascade="all, delete-orphan", lazy="selectin"
    )


class Card(UUIDMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Jedna karta = jeden kierunek notatki + wlasny stan FSRS.

    Pola stability/difficulty/step/state odpowiadaja 1:1 polom fsrs.Card (v6).
    Karta nigdy nie widziana ma stability=NULL - biblioteka nie ma osobnego
    stanu "New", nowa karta to State.Learning ze step=0.
    """

    __tablename__ = "cards"
    __table_args__ = (
        UniqueConstraint("note_id", "template_ord", name="uq_cards_note_template"),
        Index("ix_cards_due_queue", "user_id", "deck_id", "due"),
    )

    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    deck_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: 0 = Front -> Back, 1 = Back -> Front
    template_ord: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)

    # --- stan FSRS ---
    state: Mapped[int] = mapped_column(SmallInteger, default=1, nullable=False)  # 1=Learning 2=Review 3=Relearning
    step: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    due: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )
    last_review: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Liczniki, ktorych fsrs v6 juz nie trzyma w Card - prowadzimy je sami.
    # Sa odtwarzalne z review_log, wiec przy syncu nie sa zrodlem prawdy.
    reps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lapses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    note: Mapped["Note"] = relationship(back_populates="cards")

    @property
    def is_new(self) -> bool:
        return self.stability is None

    @property
    def template_label(self) -> str:
        # Import lokalny: app.core.rendering importuje modele, wiec import na
        # gorze pliku zrobilby cykl.
        from app.core.rendering import template_label

        return template_label(self.note.note_type, self.template_ord)


class Media(UUIDMixin, TimestampMixin, Base):
    """Tabela istnieje, warstwa plikow jeszcze nie.

    Schemat jest gotowy, zeby dodanie obrazkow/audio (i importu .apkg z mediami)
    nie wymagalo migracji danych. Endpointow uploadu w MVP nie ma.
    """

    __tablename__ = "media"
    __table_args__ = (UniqueConstraint("user_id", "sha256", name="uq_media_user_sha256"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
