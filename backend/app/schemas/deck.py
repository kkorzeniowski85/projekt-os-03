import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DeckCounts(BaseModel):
    new: int
    due: int
    total: int


class DeckCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    new_per_day: int = Field(default=20, ge=0, le=9999)
    max_reviews_per_day: int = Field(default=200, ge=0, le=99999)


class DeckUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    new_per_day: int | None = Field(default=None, ge=0, le=9999)
    max_reviews_per_day: int | None = Field(default=None, ge=0, le=99999)


class DeckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    new_per_day: int
    max_reviews_per_day: int
    created_at: datetime
    updated_at: datetime
    counts: DeckCounts | None = None
