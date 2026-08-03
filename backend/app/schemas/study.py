import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class StudyCard(BaseModel):
    card_id: uuid.UUID
    note_id: uuid.UUID
    deck_id: uuid.UUID
    question: str
    answer: str
    #: Zdanie przykladowe, pokazywane razem z odpowiedzia. Puste, gdy brak.
    example: str
    template_label: str
    tags: list[str]
    state: int
    is_new: bool
    due: datetime
    #: Podglad "co sie stanie po kliknieciu" dla kazdej z 4 ocen, w postaci
    #: czytelnej etykiety ("10 min", "4 dni"). Liczone tym samym schedulerem,
    #: ktory potem realnie zaplanuje karte.
    interval_preview: dict[int, str]


class StudyQueue(BaseModel):
    deck_id: uuid.UUID | None
    cards: list[StudyCard]
    new_remaining: int
    due_remaining: int


class ReviewIn(BaseModel):
    card_id: uuid.UUID
    rating: int = Field(ge=1, le=4, description="1=Again 2=Hard 3=Good 4=Easy")
    #: UUID nadawany przez klienta. Powtorne wyslanie tego samego zdarzenia
    #: (retry po utracie sieci) nie zdubluje wpisu w logu.
    client_event_id: uuid.UUID
    reviewed_at: datetime | None = None
    #: Wymagane, nie opcjonalne - bez kompletu czasow odpada pozniejsza
    #: optymalizacja retencji na wlasnej historii (patrz docs/adr/0004).
    duration_ms: int = Field(ge=0)


class ReviewOut(BaseModel):
    card_id: uuid.UUID
    state: int
    due: datetime
    scheduled_label: str
    reps: int
    lapses: int
    duplicate: bool = False
