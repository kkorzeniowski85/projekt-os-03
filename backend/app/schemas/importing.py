import uuid

from pydantic import BaseModel, Field

from app.models import ItemKind, NoteType


class FormatOut(BaseModel):
    key: str
    label: str
    extensions: list[str]
    description: str


class NoteDraftOut(BaseModel):
    fields: dict[str, str]
    tags: list[str]
    item_kind: ItemKind
    source_deck: str | None = None


class DuplicateSummary(BaseModel):
    total: int
    unique: int
    duplicates_in_file: int
    already_in_collection: int


class AnalyzeOut(BaseModel):
    job_id: uuid.UUID
    filename: str
    source_format: str
    #: Kolumny wykryte w zrodle - wejscie do mapowania.
    columns: list[str]
    #: Propozycja mapowania kolumna -> pole aplikacji. Do poprawienia przez uzytkownika.
    suggested_mapping: dict[str, str]
    #: Dozwolone cele mapowania.
    mapping_targets: list[str]
    suggested_note_type: NoteType
    source_decks: list[str]
    warnings: list[str]
    total_items: int
    preview: list[NoteDraftOut]
    duplicates: DuplicateSummary


class CommitIn(BaseModel):
    deck_id: uuid.UUID
    mapping: dict[str, str]
    note_type: NoteType = NoteType.BASIC
    #: None = kategoria zgadywana z tresci przodu kazdej fiszki osobno.
    default_item_kind: ItemKind | None = None
    skip_duplicates: bool = True


class CommitOut(BaseModel):
    job_id: uuid.UUID
    deck_id: uuid.UUID
    imported: int
    skipped_duplicates: int
    skipped_invalid: int
    total_items: int = Field(description="Liczba pozycji w pliku po normalizacji")
