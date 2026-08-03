import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.rendering import FIELD_BACK, FIELD_FRONT
from app.models import ItemKind, NoteType

REQUIRED_FIELDS = (FIELD_FRONT, FIELD_BACK)


def _validate_fields(value: dict[str, str]) -> dict[str, str]:
    missing = [f for f in REQUIRED_FIELDS if not (value.get(f) or "").strip()]
    if missing:
        raise ValueError(f"Brakuje wymaganych pol: {', '.join(missing)}")
    return value


class NoteCreate(BaseModel):
    deck_id: uuid.UUID
    note_type: NoteType = NoteType.BASIC
    #: Na dzis wymagane sa "Front" i "Back"; dict zostawia miejsce na wiecej pol
    #: bez migracji, gdy pojawia sie konfigurowalne typy notatek.
    fields: dict[str, str]
    tags: list[str] = Field(default_factory=list)
    #: None = kategoria zgadywana z tresci przodu (slowo / fraza / zdanie).
    item_kind: ItemKind | None = None

    _check_fields = field_validator("fields")(_validate_fields)


class NoteUpdate(BaseModel):
    deck_id: uuid.UUID | None = None
    note_type: NoteType | None = None
    fields: dict[str, str] | None = None
    tags: list[str] | None = None
    item_kind: ItemKind | None = None

    @field_validator("fields")
    @classmethod
    def check_fields(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        return None if value is None else _validate_fields(value)


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    template_ord: int
    template_label: str
    state: int
    due: datetime
    stability: float | None
    difficulty: float | None
    reps: int
    lapses: int
    is_new: bool


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    deck_id: uuid.UUID
    note_type: NoteType
    item_kind: ItemKind
    fields: dict[str, str]
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    cards: list[CardOut] = Field(default_factory=list)


class NoteListOut(BaseModel):
    items: list[NoteOut]
    total: int
