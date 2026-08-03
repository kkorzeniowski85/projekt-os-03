from pydantic import BaseModel

from app.models import ItemKind


class DailyPoint(BaseModel):
    day: str
    reviews: int
    seconds: int
    retention: float | None


class Overview(BaseModel):
    days: int
    reviews: int
    reviews_all_time: int
    cards_touched: int
    total_seconds: int
    seconds_per_review: float | None
    #: Rzeczywista skutecznosc: odsetek zaliczonych powtorek wsrod kart w stanie
    #: Review. Powtorki w trakcie nauki nie sa wliczane.
    retention: float | None
    retention_young: float | None
    retention_mature: float | None
    #: Liczba powtorek, na ktorych policzono skutecznosc. Bez niej wynik jest
    #: nieinterpretowalny.
    retention_sample: int
    streak_days: int
    daily: list[DailyPoint]
    ratings: dict[str, int]


class ItemKindStats(BaseModel):
    item_kind: ItemKind
    cards: int
    notes: int
    new_cards: int
    reviews: int
    #: None, gdy probka jest za mala, zeby liczba cokolwiek znaczyla.
    retention: float | None
    retention_sample: int
    avg_stability_days: float | None
    avg_difficulty: float | None
    lapses: int
    seconds_per_review: float | None


class TagStats(BaseModel):
    tag: str
    cards: int
    reviews: int
    retention: float | None
    retention_sample: int


class LeechCard(BaseModel):
    card_id: str
    note_id: str
    front: str
    back: str
    item_kind: ItemKind
    deck_name: str
    lapses: int
    reps: int
    stability_days: float | None
    difficulty: float | None
    is_leech: bool


class ForecastPoint(BaseModel):
    day: str
    count: int
