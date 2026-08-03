from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CARDS_PER_NOTE_TYPE, Card, Note
from app.models.base import utcnow


def sync_cards(db: Session, note: Note) -> None:
    """Doprowadza zestaw kart notatki do zgodnosci z jej typem.

    Zmiana basic -> basic_reversed doklada kierunek Back->Front; zmiana w druga
    strone kasuje go miekko (historia powtorek zostaje). Karta wczesniej
    skasowana i przywracana odzyskuje swoj stan FSRS zamiast startowac od zera -
    dlatego szukamy jej zamiast tworzyc nowa.
    """
    wanted = CARDS_PER_NOTE_TYPE[note.note_type]
    existing = {c.template_ord: c for c in db.scalars(select(Card).where(Card.note_id == note.id))}

    for ord_ in range(wanted):
        card = existing.get(ord_)
        if card is None:
            db.add(
                Card(
                    note_id=note.id,
                    user_id=note.user_id,
                    deck_id=note.deck_id,
                    template_ord=ord_,
                )
            )
        else:
            card.deleted_at = None
            card.deck_id = note.deck_id

    for ord_, card in existing.items():
        if ord_ >= wanted and card.deleted_at is None:
            card.deleted_at = utcnow()
