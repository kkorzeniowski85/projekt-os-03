"""Testy warstwy planowania (app/core/scheduler.py).

Nie wymagaja bazy: scheduler operuje na obiektach modeli w pamieci i nigdy sam
nie siega do sesji. Karty budujemy recznie, bo wartosci domyslne kolumn SQLAlchemy
sa nadawane dopiero przy zapisie.

Karty "dojrzale" doprowadzamy do stanu Review przez prawdziwe oceny, a nie przez
recznie wpisana stability - inaczej test sprawdzalby wymyslony stan, ktory
w aplikacji nigdy nie powstaje.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fsrs import Rating, State

from app.core import scheduler as sched
from app.models import Card, User

NOW = datetime(2026, 1, 15, 12, 0, tzinfo=timezone.utc)


def make_user(desired_retention: float = 0.9, parameters: list[float] | None = None) -> User:
    return User(
        id=uuid.uuid4(),
        email="test@example.test",
        password_hash="x",
        display_name="Test",
        desired_retention=desired_retention,
        fsrs_parameters=parameters,
    )


def make_card(**overrides) -> Card:
    """Swiezo dodana karta: stability=None, czyli nigdy nie widziana."""
    values = {
        "id": uuid.uuid4(),
        "note_id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "deck_id": uuid.uuid4(),
        "template_ord": 0,
        "state": State.Learning.value,
        "step": 0,
        "stability": None,
        "difficulty": None,
        "due": NOW,
        "last_review": None,
        "reps": 0,
        "lapses": 0,
    }
    values.update(overrides)
    return Card(**values)


def bring_to_review(card: Card, user: User, at: datetime = NOW) -> datetime:
    """Ocenia karte "Dobre" w kolejnych terminach, az wejdzie w stan Review.

    Zwraca moment, w ktorym karta jest nastepnie zaplanowana.
    """
    moment = at
    for _ in range(10):
        if card.state == State.Review.value:
            return moment
        sched.review(card, user, rating=Rating.Good.value, review_datetime=moment,
                     review_duration_ms=1500)
        moment = card.due
    raise AssertionError("karta nie osiagnela stanu Review w 10 powtorkach")


def fsrs_state(card: Card) -> tuple:
    return (card.state, card.step, card.stability, card.difficulty, card.due, card.last_review)


# --- determinizm -----------------------------------------------------------
#
# To jest wlasnosc, na ktorej stoi caly model synchronizacji (docs/adr/0002):
# stan karty musi dac sie odtworzyc z review_log. Wlaczenie fuzzingu zepsuloby
# to po cichu - scalanie dwoch sesji offline dawaloby inny wynik na kazdym
# urzadzeniu, a zaden istniejacy test by nie zaprotestowal. Stad ten blok.


def test_fuzzing_pozostaje_wylaczony():
    assert sched.ENABLE_FUZZING is False, (
        "Wlaczenie fuzzingu lamie zalozenie ADR 0002 - przeczytaj je przed zmiana"
    )


@pytest.mark.parametrize("mature", [False, True])
def test_ta_sama_ocena_daje_ten_sam_wynik(mature):
    """Wariant `mature` jest tu istotny, nie ozdobny.

    FSRS rozrzuca dopiero interwaly kilkudniowe, wiec na swiezej karcie (kroki
    nauki liczone w minutach) ten test przeszedlby takze z wlaczonym fuzzingiem.
    Dopiero karta w stanie Review realnie tego pilnuje.
    """
    user = make_user()
    first, second = make_card(), make_card()
    at_first = bring_to_review(first, user) if mature else NOW
    at_second = bring_to_review(second, user) if mature else NOW
    assert at_first == at_second, "dojscie do stanu Review juz sie rozjechalo"

    sched.review(first, user, rating=Rating.Good.value, review_datetime=at_first,
                 review_duration_ms=2000)
    sched.review(second, user, rating=Rating.Good.value, review_datetime=at_second,
                 review_duration_ms=2000)

    assert fsrs_state(first) == fsrs_state(second)


def test_dlugi_interwal_nie_jest_rozrzucany():
    """Fuzzing dotyka dopiero interwalow kilkudniowych - tu bylby widoczny."""
    user = make_user()
    reference = make_card()
    at = bring_to_review(reference, user)

    dues = set()
    for _ in range(20):
        card = make_card(
            state=reference.state,
            step=reference.step,
            stability=reference.stability,
            difficulty=reference.difficulty,
            due=reference.due,
            last_review=reference.last_review,
            reps=reference.reps,
        )
        sched.review(card, user, rating=Rating.Easy.value, review_datetime=at,
                     review_duration_ms=1000)
        dues.add(card.due)

    assert len(dues) == 1, f"interwal rozjechal sie na {len(dues)} wariantow - fuzzing wlaczony?"


def test_pelna_sciezka_odtwarza_sie_z_tych_samych_ocen():
    """Odtworzenie logu ocena po ocenie musi dac identyczna karte."""
    user = make_user()
    ratings = [3, 3, 1, 2, 3, 4, 3]

    def replay() -> tuple:
        card = make_card()
        moment = NOW
        for rating in ratings:
            sched.review(card, user, rating=rating, review_datetime=moment,
                         review_duration_ms=1200)
            moment = card.due
        return fsrs_state(card) + (card.reps, card.lapses)

    assert replay() == replay()


# --- wpadki i liczniki -----------------------------------------------------


def test_again_na_karcie_w_nauce_nie_jest_wpadka():
    """"Znowu" w trakcie nauki to normalny krok algorytmu, nie zapomnienie."""
    user = make_user()
    card = make_card()

    sched.review(card, user, rating=Rating.Again.value, review_datetime=NOW,
                 review_duration_ms=3000)

    assert card.lapses == 0
    assert card.reps == 1


def test_again_na_karcie_nauczonej_jest_wpadka():
    user = make_user()
    card = make_card()
    at = bring_to_review(card, user)
    assert card.lapses == 0

    sched.review(card, user, rating=Rating.Again.value, review_datetime=at,
                 review_duration_ms=3000)

    assert card.lapses == 1


@pytest.mark.parametrize("rating", [Rating.Hard.value, Rating.Good.value, Rating.Easy.value])
def test_poprawna_odpowiedz_nie_zwieksza_wpadek(rating):
    user = make_user()
    card = make_card()
    at = bring_to_review(card, user)

    sched.review(card, user, rating=rating, review_datetime=at, review_duration_ms=1000)

    assert card.lapses == 0


@pytest.mark.parametrize("rating", [1, 2, 3, 4])
def test_kazda_ocena_zwieksza_licznik_powtorek(rating):
    user = make_user()
    card = make_card()

    sched.review(card, user, rating=rating, review_datetime=NOW, review_duration_ms=1000)

    assert card.reps == 1


def test_pierwsza_powtorka_przestaje_byc_nowa():
    user = make_user()
    card = make_card()
    assert card.is_new

    sched.review(card, user, rating=Rating.Good.value, review_datetime=NOW,
                 review_duration_ms=1000)

    assert not card.is_new
    assert card.stability is not None
    assert card.difficulty is not None
    assert card.last_review == NOW
    assert card.due > NOW


# --- wpis do review_log ----------------------------------------------------


def test_stan_przed_pierwsza_powtorka_ma_pusta_stability():
    """Na tym opiera sie licznik "nowe dzisiaj" w kolejce (app/api/study.py).

    Kolejka rozpoznaje karte nowa po tym, ze w chwili powtorki nie miala jeszcze
    stability. Gdyby scheduler zapisywal tu stan PO ocenie, licznik dziennego
    limitu nowych kart cicho przestalby dzialac.
    """
    user = make_user()
    card = make_card()

    state_before, state_after = sched.review(
        card, user, rating=Rating.Good.value, review_datetime=NOW, review_duration_ms=1000
    )

    assert state_before["stability"] is None
    assert state_after["stability"] is not None


def test_stan_po_powtorce_zgadza_sie_z_karta():
    user = make_user()
    card = make_card()

    _, state_after = sched.review(card, user, rating=Rating.Good.value, review_datetime=NOW,
                                  review_duration_ms=1000)

    assert state_after["stability"] == card.stability
    assert state_after["difficulty"] == card.difficulty
    assert state_after["step"] == card.step


def test_stany_daja_sie_zapisac_do_jsonb():
    """Oba slowniki ida wprost do kolumny JSONB - musza byc serializowalne."""
    user = make_user()
    card = make_card()

    state_before, state_after = sched.review(
        card, user, rating=Rating.Good.value, review_datetime=NOW, review_duration_ms=1000
    )

    assert json.loads(json.dumps(state_before)) == state_before
    assert json.loads(json.dumps(state_after)) == state_after


def test_naiwna_data_traktowana_jest_jako_utc():
    user = make_user()
    card = make_card()

    sched.review(card, user, rating=Rating.Good.value,
                 review_datetime=NOW.replace(tzinfo=None), review_duration_ms=1000)

    assert card.last_review == NOW


# --- podglad interwalow ----------------------------------------------------


def test_podglad_zwraca_wszystkie_cztery_oceny():
    user = make_user()
    card = make_card()

    preview = sched.preview_intervals(card, user, at=NOW)

    assert set(preview) == {1, 2, 3, 4}
    assert all(isinstance(label, str) and label for label in preview.values())


def test_podglad_nie_rusza_karty():
    user = make_user()
    card = make_card()
    before = fsrs_state(card) + (card.reps, card.lapses)

    sched.preview_intervals(card, user, at=NOW)

    assert fsrs_state(card) + (card.reps, card.lapses) == before


@pytest.mark.parametrize("rating", [1, 2, 3, 4])
@pytest.mark.parametrize("mature", [False, True])
def test_podglad_nie_klamie(rating, mature):
    """Etykieta na przycisku musi zgadzac sie z tym, co naprawde sie stanie."""
    user = make_user()
    card = make_card()
    at = bring_to_review(card, user) if mature else NOW

    promised = sched.preview_intervals(card, user, at=at)[rating]
    sched.review(card, user, rating=rating, review_datetime=at, review_duration_ms=1000)
    actual = sched.humanize_interval(card.due - at)

    assert promised == actual


def test_lepsza_ocena_odsuwa_karte_dalej():
    user = make_user()
    reference = make_card()
    at = bring_to_review(reference, user)

    dues = []
    for rating in (1, 2, 3, 4):
        card = make_card(
            state=reference.state,
            step=reference.step,
            stability=reference.stability,
            difficulty=reference.difficulty,
            due=reference.due,
            last_review=reference.last_review,
        )
        sched.review(card, user, rating=rating, review_datetime=at, review_duration_ms=1000)
        dues.append(card.due)

    assert dues == sorted(dues), f"kolejnosc ocen nie ma sensu: {dues}"


# --- ustawienia uzytkownika ------------------------------------------------


def test_wyzsza_zadana_skutecznosc_skraca_interwaly():
    """Sprawdza, ze desired_retention faktycznie dociera do schedulera."""
    ostrozny, luzny = make_user(0.95), make_user(0.80)
    card_a, card_b = make_card(), make_card()

    at_a = bring_to_review(card_a, ostrozny)
    at_b = bring_to_review(card_b, luzny)
    sched.review(card_a, ostrozny, rating=3, review_datetime=at_a, review_duration_ms=1000)
    sched.review(card_b, luzny, rating=3, review_datetime=at_b, review_duration_ms=1000)

    assert (card_a.due - at_a) < (card_b.due - at_b)


def test_wersja_schedulera_rozroznia_wagi_wlasne():
    assert sched.scheduler_version(make_user()).endswith("/default")
    assert sched.scheduler_version(make_user(parameters=[0.5] * 21)).endswith("/custom")


# --- konwersja modelu ------------------------------------------------------


def test_konwersja_tam_i_z_powrotem_nic_nie_gubi():
    user = make_user()
    card = make_card()
    bring_to_review(card, user)
    before = fsrs_state(card)

    sched.apply_fsrs(card, sched.to_fsrs(card))

    assert fsrs_state(card) == before


def test_rozne_karty_dostaja_rozne_identyfikatory_fsrs():
    assert sched._fsrs_card_id(make_card()) != sched._fsrs_card_id(make_card())


# --- retrievability --------------------------------------------------------


def test_szansa_odpowiedzi_spada_z_czasem():
    user = make_user()
    card = make_card()
    at = bring_to_review(card, user)

    zaraz_po = sched.retrievability(card, user, at=at)
    duzo_pozniej = sched.retrievability(card, user, at=at + timedelta(days=365))

    assert 0.0 <= duzo_pozniej < zaraz_po <= 1.0


# --- etykiety --------------------------------------------------------------


@pytest.mark.parametrize(
    "delta, expected",
    [
        (timedelta(0), "1 min"),
        (timedelta(seconds=30), "1 min"),
        (timedelta(seconds=-600), "1 min"),  # karta zalegla - nigdy ujemna etykieta
        (timedelta(minutes=10), "10 min"),
        (timedelta(minutes=59), "59 min"),
        (timedelta(minutes=60), "1 godz."),
        (timedelta(hours=23, minutes=59), "23 godz."),
        (timedelta(hours=24), "1 dzien"),
        (timedelta(days=2), "2 dni"),
        (timedelta(days=29), "29 dni"),
        (timedelta(days=30), "1 mies."),
        (timedelta(days=330), "11 mies."),
        (timedelta(days=730), "2.0 lat"),
    ],
)
def test_etykieta_interwalu(delta, expected):
    assert sched.humanize_interval(delta) == expected
