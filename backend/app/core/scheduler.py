"""Cienka warstwa miedzy modelem bazy a biblioteka `fsrs` (py-fsrs 6.x).

Jedyne miejsce w projekcie, ktore wie, jak dziala FSRS. Reszta kodu operuje na
modelu `Card` i nie importuje `fsrs` bezposrednio.
"""

from datetime import datetime, timedelta, timezone
from importlib.metadata import PackageNotFoundError, version

from fsrs import Card as FSRSCard, Rating, Scheduler, State

from app.models import Card, User

try:
    _FSRS_VERSION = version("fsrs")
except PackageNotFoundError:  # pragma: no cover - tylko przy dziwnej instalacji
    _FSRS_VERSION = "unknown"


# Fuzzing celowo wylaczony.
#
# Domyslnie FSRS losowo rozrzuca interwaly (+/- kilka procent), zeby powtorki
# nie zlepialy sie w jeden dzien. Cena tego jest taka, ze scheduler przestaje
# byc funkcja czysta - tego samego logu powtorek nie da sie odtworzyc.
#
# Nasz model synchronizacji (docs/adr/0002) zaklada, ze stan karty jest
# odtwarzalny z review_log. Bez determinizmu scalenie dwoch sesji offline
# dawaloby rozny wynik na kazdym urzadzeniu. Wybieramy determinizm.
ENABLE_FUZZING = False


def scheduler_version(user: User) -> str:
    suffix = "custom" if user.fsrs_parameters else "default"
    return f"fsrs-{_FSRS_VERSION}/{suffix}"


def get_scheduler(user: User) -> Scheduler:
    kwargs = {
        "desired_retention": user.desired_retention,
        "enable_fuzzing": ENABLE_FUZZING,
    }
    if user.fsrs_parameters:
        kwargs["parameters"] = user.fsrs_parameters
    return Scheduler(**kwargs)


def _fsrs_card_id(card: Card) -> int:
    """fsrs.Card wymaga int-owego id; nasze klucze to UUID.

    Biblioteka uzywa card_id tylko do etykietowania wlasnego ReviewLog, ktorego
    nie zapisujemy (mamy swoj). Wyprowadzamy stabilna liczbe z UUID wylacznie
    po to, zeby dane w state_before/state_after dalo sie powiazac z karta.
    """
    return int.from_bytes(card.id.bytes[:6], "big")


def to_fsrs(card: Card) -> FSRSCard:
    return FSRSCard(
        card_id=_fsrs_card_id(card),
        state=State(card.state),
        step=card.step,
        stability=card.stability,
        difficulty=card.difficulty,
        due=card.due,
        last_review=card.last_review,
    )


def apply_fsrs(card: Card, fsrs_card: FSRSCard) -> None:
    card.state = int(fsrs_card.state.value)
    card.step = fsrs_card.step
    card.stability = fsrs_card.stability
    card.difficulty = fsrs_card.difficulty
    card.due = fsrs_card.due
    card.last_review = fsrs_card.last_review


def review(
    card: Card,
    user: User,
    rating: int,
    review_datetime: datetime | None = None,
    review_duration_ms: int | None = None,
) -> tuple[dict, dict]:
    """Ocenia karte, aktualizuje ja w miejscu i zwraca (state_before, state_after).

    Zwrocone slowniki ida wprost do review_log.
    """
    now = review_datetime or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    was_review_state = card.state == State.Review.value

    fsrs_card = to_fsrs(card)
    state_before = fsrs_card.to_dict()

    scheduler = get_scheduler(user)
    updated, _ = scheduler.review_card(
        fsrs_card, Rating(rating), review_datetime=now, review_duration=review_duration_ms
    )

    apply_fsrs(card, updated)
    card.reps += 1
    # "Lapse" to zapomnienie karty juz nauczonej. Again na karcie w trakcie
    # nauki (Learning) nie jest wpadka, tylko normalnym krokiem.
    if rating == Rating.Again.value and was_review_state:
        card.lapses += 1

    return state_before, updated.to_dict()


def preview_intervals(
    card: Card, user: User, at: datetime | None = None
) -> dict[int, str]:
    """Dla kazdej z 4 ocen liczy, kiedy karta wrocilaby do kolejki.

    Uzywane przez ekran nauki, zeby na przyciskach pokazac "10 min / 4 dni".
    Nic nie zapisuje - dziala na kopii stanu.
    """
    now = at or datetime.now(timezone.utc)
    scheduler = get_scheduler(user)
    out: dict[int, str] = {}
    for rating in Rating:
        updated, _ = scheduler.review_card(to_fsrs(card), rating, review_datetime=now)
        out[int(rating.value)] = humanize_interval(updated.due - now)
    return out


def humanize_interval(delta: timedelta) -> str:
    minutes = max(int(delta.total_seconds() // 60), 0)
    if minutes < 60:
        return f"{max(minutes, 1)} min"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} godz."
    days = hours // 24
    if days < 30:
        return f"{days} dni" if days != 1 else "1 dzien"
    months = days // 30
    if months < 12:
        return f"{months} mies."
    years = days / 365
    return f"{years:.1f} lat"


def retrievability(card: Card, user: User, at: datetime | None = None) -> float:
    """Szacowane prawdopodobienstwo poprawnej odpowiedzi w danym momencie."""
    return get_scheduler(user).get_card_retrievability(
        to_fsrs(card), current_datetime=at or datetime.now(timezone.utc)
    )
