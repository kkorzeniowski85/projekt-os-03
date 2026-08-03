"""Testy importerow. Nie wymagaja bazy - parsery sa czystymi funkcjami.

Pliki .apkg budujemy syntetycznie, w obu wariantach schematu Anki, zeby nie
trzymac binariow w repozytorium i zeby test opisywal wprost, jak ten format
wyglada.
"""

import io
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from app.core.rendering import FIELD_BACK, FIELD_EXAMPLE, FIELD_FRONT
from app.importers import (
    TARGET_IGNORE,
    TARGET_TAGS,
    ImportError_,
    content_hash,
    detect_format,
    guess_item_kind,
    parse,
)
from app.models import ItemKind
from app.services.importing import normalize

# --- heurystyki ------------------------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("ubiquitous", ItemKind.WORD),
        ("kick the bucket", ItemKind.PHRASE),
        ("od czasu do czasu", ItemKind.PHRASE),
        ("Smartphones are ubiquitous these days.", ItemKind.SENTENCE),
        ("Czy mogę prosić o rachunek?", ItemKind.SENTENCE),
        ("to jest juz calkiem dlugie wyrazenie bez kropki", ItemKind.SENTENCE),
        ("", ItemKind.OTHER),
    ],
)
def test_guess_item_kind(text, expected):
    assert guess_item_kind(text) is expected


def test_content_hash_ignores_formatting_and_case():
    a = {FIELD_FRONT: "  Kot ", FIELD_BACK: "cat"}
    b = {FIELD_FRONT: "kot", FIELD_BACK: "CAT"}
    assert content_hash(a) == content_hash(b)


def test_content_hash_ignores_example_field():
    """Dopisanie zdania przykladowego nie czyni fiszki nowa."""
    without = {FIELD_FRONT: "kot", FIELD_BACK: "cat"}
    with_example = {**without, FIELD_EXAMPLE: "The cat is asleep."}
    assert content_hash(without) == content_hash(with_example)


def test_content_hash_distinguishes_content():
    assert content_hash({FIELD_FRONT: "kot", FIELD_BACK: "cat"}) != content_hash(
        {FIELD_FRONT: "pies", FIELD_BACK: "dog"}
    )


# --- CSV -------------------------------------------------------------------


def test_csv_with_polish_headers_maps_itself():
    data = "przód;tył;tagi\nkot;cat;zwierzeta\npies;dog;zwierzeta\n".encode("utf-8")
    result = parse("talia.csv", data)

    assert result.source_format == "csv"
    assert result.columns == ["przód", "tył", "tagi"]
    assert result.suggested_mapping == {
        "przód": FIELD_FRONT,
        "tył": FIELD_BACK,
        "tagi": TARGET_TAGS,
    }
    assert len(result.rows) == 2


def test_csv_english_headers_and_example_column():
    data = b"Term,Definition,Example\nubiquitous,wszechobecny,It is ubiquitous.\n"
    result = parse("quizlet.csv", data)
    assert result.suggested_mapping == {
        "Term": FIELD_FRONT,
        "Definition": FIELD_BACK,
        "Example": FIELD_EXAMPLE,
    }


def test_csv_without_header_falls_back_to_position():
    data = "kot;cat\npies;dog\nryba;fish\n".encode("utf-8")
    result = parse("bez-naglowka.csv", data)

    assert result.columns == ["kolumna 1", "kolumna 2"]
    assert result.suggested_mapping["kolumna 1"] == FIELD_FRONT
    assert result.suggested_mapping["kolumna 2"] == FIELD_BACK
    assert len(result.rows) == 3
    assert any("naglowka" in w for w in result.warnings)


def test_csv_header_detection_can_be_overridden():
    """Przy 'kot;cat' zadna heurystyka nie ma pewnosci - decyduje uzytkownik."""
    data = "kot;cat\npies;dog\n".encode("utf-8")

    from app.importers import tabular

    forced = tabular.parse(data, {"has_header": True})
    assert forced.columns == ["kot", "cat"]
    assert len(forced.rows) == 1

    rejected = tabular.parse(data, {"has_header": False})
    assert rejected.columns == ["kolumna 1", "kolumna 2"]
    assert len(rejected.rows) == 2


def test_csv_header_decision_is_always_reported():
    """Uzytkownik ma widziec, jak plik zostal zrozumiany, a nie zgadywac."""
    with_header = parse("a.csv", b"front,back\nkot,cat\n")
    assert any("naglowek" in w for w in with_header.warnings)

    without_header = parse("b.csv", "kot;cat\npies;dog\n".encode("utf-8"))
    assert any("naglowka" in w for w in without_header.warnings)


def test_csv_tab_separated():
    data = b"front\tback\nkot\tcat\n"
    result = parse("dane.tsv", data)
    assert len(result.rows) == 1
    assert result.rows[0].values["front"] == "kot"


def test_csv_cp1250_encoding():
    """Arkusze z Windows nie zawsze sa w UTF-8."""
    data = "przód;tył\nzażółć;gęślą\n".encode("cp1250")
    result = parse("windows.csv", data)
    assert result.rows[0].values["przód"] == "zażółć"


def test_csv_extra_columns_are_ignored_by_default():
    data = b"front,back,notes,zrodlo\nkot,cat,x,y\n"
    result = parse("szeroki.csv", data)
    targets = list(result.suggested_mapping.values())
    assert targets.count(TARGET_IGNORE) == 2


def test_empty_file_is_rejected():
    with pytest.raises(ImportError_):
        parse("pusty.csv", b"   \n  \n")


# --- zwykly tekst ----------------------------------------------------------


def test_plaintext_dash_separator():
    data = "kot - cat\npies - dog\n# komentarz\nryba - fish\n".encode("utf-8")
    result = parse("lista.txt", data)

    assert result.source_format == "text"
    assert len(result.rows) == 3
    assert result.rows[0].values == {"przod": "kot", "tyl": "cat"}


def test_plaintext_keeps_hyphenated_words():
    """Myslnik bez spacji jest czescia slowa, nie separatorem."""
    data = "well-known - dobrze znany\n".encode("utf-8")
    result = parse("lista.txt", data)
    assert result.rows[0].values["przod"] == "well-known"


def test_plaintext_without_separator_is_rejected():
    with pytest.raises(ImportError_):
        parse("lista.txt", "sama treść bez separatora\ndruga linia\n".encode("utf-8"))


# --- format kanoniczny -----------------------------------------------------


def test_canonical_json_needs_no_mapping():
    payload = {
        "format": "fiszki/v1",
        "deck": "Angielski B2",
        "default_note_type": "basic_reversed",
        "notes": [
            {
                "front": "ubiquitous",
                "back": "wszechobecny",
                "example": "Smartphones are ubiquitous.",
                "tags": ["b2", "przymiotnik"],
                "kind": "word",
                "source_ref": "oxford/ubiquitous",
            },
            {"front": "kick the bucket", "back": "kopnąć w kalendarz", "kind": "expression"},
        ],
    }
    result = parse("talia.json", json.dumps(payload).encode("utf-8"))

    assert result.source_format == "fiszki-json"
    assert result.suggested_note_type.value == "basic_reversed"
    assert result.source_decks == ["Angielski B2"]
    # Mapowanie jest tozsamosciowe - format juz jest docelowy.
    assert all(k == v for k, v in result.suggested_mapping.items())

    drafts = normalize(result, result.suggested_mapping)
    assert len(drafts) == 2
    assert drafts[0]["fields"][FIELD_EXAMPLE] == "Smartphones are ubiquitous."
    assert drafts[0]["tags"] == ["b2", "przymiotnik"]
    assert drafts[0]["item_kind"] == "word"
    assert drafts[0]["source_ref"] == "oxford/ubiquitous"
    # EXPRESSION nie jest zgadywane - musi pochodzic wprost ze zrodla.
    assert drafts[1]["item_kind"] == "expression"


def test_canonical_json_bare_list_is_accepted():
    payload = [{"front": "kot", "back": "cat"}]
    result = parse("lista.json", json.dumps(payload).encode("utf-8"))
    assert len(result.rows) == 1
    assert any("koperty" in w for w in result.warnings)


def test_canonical_json_skips_incomplete_notes():
    payload = {"notes": [{"front": "kot", "back": "cat"}, {"front": "sam przód"}]}
    result = parse("talia.json", json.dumps(payload).encode("utf-8"))
    assert len(result.rows) == 1
    assert any("pominieta" in w for w in result.warnings)


def test_broken_json_is_rejected():
    with pytest.raises(ImportError_):
        parse("talia.json", b"{ to nie jest json")


# --- Anki ------------------------------------------------------------------

_ANKI_LEGACY_SCHEMA = """
CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer,
  ver integer, dty integer, usn integer, ls integer, conf text, models text,
  decks text, dconf text, tags text);
CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer,
  usn integer, tags text, flds text, sfld integer, csum integer, flags integer, data text);
CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer,
  mod integer, usn integer, type integer, queue integer, due integer, ivl integer,
  factor integer, reps integer, lapses integer, left integer, odue integer,
  odid integer, flags integer, data text);
"""

_ANKI_V18_SCHEMA = """
CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer,
  ver integer, dty integer, usn integer, ls integer, conf text, models text,
  decks text, dconf text, tags text);
CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer,
  usn integer, tags text, flds text, sfld integer, csum integer, flags integer, data text);
CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer,
  mod integer, usn integer, type integer, queue integer, due integer, ivl integer,
  factor integer, reps integer, lapses integer, left integer, odue integer,
  odid integer, flags integer, data text);
CREATE TABLE notetypes (id integer primary key, name text, mtime_secs integer,
  usn integer, config blob);
CREATE TABLE fields (ntid integer, ord integer, name text, config blob,
  primary key (ntid, ord));
CREATE TABLE decks (id integer primary key, name text, mtime_secs integer,
  usn integer, common blob, kind blob);
"""

_NOTES = [
    # (id, mid, tags, flds)
    (1001, 55, " angielski b2 ", "ubiquitous\x1fwszechobecny"),
    (1002, 55, "", "<b>kot</b><br>domowy\x1fcat"),
    (1003, 55, "idiom", "kick the bucket\x1f<img src='x.png'>kopnąć w kalendarz"),
]
_CARDS = [(1, 1001, 7, 0), (2, 1002, 7, 0), (3, 1003, 8, 0)]


def _build_legacy_apkg(tmp_path: Path) -> bytes:
    db_path = tmp_path / "collection.anki2"
    db = sqlite3.connect(db_path)
    db.executescript(_ANKI_LEGACY_SCHEMA)

    models = {
        "55": {
            "name": "Basic",
            "flds": [{"name": "Przód", "ord": 0}, {"name": "Tył", "ord": 1}],
        }
    }
    decks = {"7": {"name": "Angielski::B2"}, "8": {"name": "Idiomy"}}
    db.execute(
        "INSERT INTO col (id, ver, models, decks) VALUES (1, 11, ?, ?)",
        (json.dumps(models), json.dumps(decks)),
    )
    db.executemany(
        "INSERT INTO notes (id, mid, tags, flds) VALUES (?, ?, ?, ?)", _NOTES
    )
    db.executemany("INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, ?, ?)", _CARDS)
    db.commit()
    db.close()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("collection.anki2", db_path.read_bytes())
        archive.writestr("media", "{}")
    return buffer.getvalue()


def _build_v18_apkg(tmp_path: Path) -> bytes:
    db_path = tmp_path / "collection.sqlite"
    db = sqlite3.connect(db_path)
    db.executescript(_ANKI_V18_SCHEMA)

    db.execute("INSERT INTO col (id, ver, models, decks) VALUES (1, 18, '', '')")
    db.execute("INSERT INTO notetypes (id, name) VALUES (55, 'Basic')")
    db.executemany(
        "INSERT INTO fields (ntid, ord, name) VALUES (?, ?, ?)",
        [(55, 0, "Przód"), (55, 1, "Tył")],
    )
    # W schemacie 18 hierarchia talii jest rozdzielana znakiem \x1f, nie '::'.
    db.executemany(
        "INSERT INTO decks (id, name) VALUES (?, ?)",
        [(7, "Angielski\x1fB2"), (8, "Idiomy")],
    )
    db.executemany("INSERT INTO notes (id, mid, tags, flds) VALUES (?, ?, ?, ?)", _NOTES)
    db.executemany("INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, ?, ?)", _CARDS)
    db.commit()
    db.close()

    import zstandard

    compressed = zstandard.ZstdCompressor().compress(db_path.read_bytes())
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("collection.anki21b", compressed)
    return buffer.getvalue()


@pytest.fixture(params=["legacy", "v18"])
def apkg(request, tmp_path):
    builder = _build_legacy_apkg if request.param == "legacy" else _build_v18_apkg
    return builder(tmp_path)


def test_apkg_is_detected_by_content_not_extension(apkg):
    assert detect_format("cokolwiek.bin", apkg).key == "anki"


def test_apkg_uses_notetype_field_names(apkg):
    result = parse("talia.apkg", apkg)
    assert result.source_format == "anki"
    assert result.columns == ["Przód", "Tył"]
    assert result.suggested_mapping == {"Przód": FIELD_FRONT, "Tył": FIELD_BACK}


def test_apkg_strips_html_and_reads_tags(apkg):
    result = parse("talia.apkg", apkg)
    rows = {row.values["Przód"]: row for row in result.rows}

    assert rows["ubiquitous"].tags == ["angielski", "b2"]
    # <b> znika, <br> staje sie zlamaniem linii.
    assert rows["kot\ndomowy"].values["Tył"] == "cat"
    assert rows["kick the bucket"].values["Tył"] == "kopnąć w kalendarz"


def test_apkg_resolves_deck_names(apkg):
    result = parse("talia.apkg", apkg)
    assert result.source_decks == ["Angielski::B2", "Idiomy"]


def test_apkg_warns_about_media_and_review_state(apkg):
    result = parse("talia.apkg", apkg)
    joined = " ".join(result.warnings)
    assert "obrazki" in joined
    assert "SM-2" in joined


def test_apkg_source_ref_allows_reimport(apkg):
    result = parse("talia.apkg", apkg)
    assert {row.source_ref for row in result.rows} == {"anki:1001", "anki:1002", "anki:1003"}


def test_broken_archive_is_rejected():
    with pytest.raises(ImportError_):
        parse("talia.apkg", b"PK\x03\x04 to nie jest prawdziwy zip")


def test_zip_without_collection_is_rejected(tmp_path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("cokolwiek.txt", "nie tedy droga")
    with pytest.raises(ImportError_):
        parse("talia.apkg", buffer.getvalue())


# --- normalizacja ----------------------------------------------------------


def test_normalize_applies_user_mapping():
    data = b"a,b,c\nkot,cat,zwierze\n"
    result = parse("dane.csv", data)
    # Uzytkownik odwraca kolumny wzgledem sugestii.
    drafts = normalize(result, {"a": FIELD_BACK, "b": FIELD_FRONT, "c": TARGET_TAGS})

    assert drafts[0]["fields"][FIELD_FRONT] == "cat"
    assert drafts[0]["fields"][FIELD_BACK] == "kot"
    assert drafts[0]["tags"] == ["zwierze"]


def test_normalize_drops_rows_without_both_sides():
    data = b"front,back\nkot,cat\n,samo tyl\nsam przod,\n"
    result = parse("dane.csv", data)
    drafts = normalize(result, result.suggested_mapping)
    assert len(drafts) == 1


def test_normalize_default_kind_overrides_heuristic():
    data = b"front,back\nkot,cat\n"
    result = parse("dane.csv", data)

    guessed = normalize(result, result.suggested_mapping)
    assert guessed[0]["item_kind"] == "word"

    forced = normalize(result, result.suggested_mapping, default_kind=ItemKind.EXPRESSION)
    assert forced[0]["item_kind"] == "expression"


def test_normalize_source_column_beats_default_kind():
    """Zrodlo wie lepiej niz nasze ustawienie domyslne."""
    data = b"front,back,rodzaj\nkot,cat,zdanie\n"
    result = parse("dane.csv", data)
    drafts = normalize(result, result.suggested_mapping, default_kind=ItemKind.WORD)
    assert drafts[0]["item_kind"] == "sentence"


def test_normalize_splits_tags_on_comma_and_semicolon():
    data = b"front\tback\ttags\nkot\tcat\tzwierzeta; domowe, ssaki\n"
    result = parse("dane.tsv", data)
    drafts = normalize(result, result.suggested_mapping)
    assert drafts[0]["tags"] == ["domowe", "ssaki", "zwierzeta"]


def test_normalize_is_stable_for_deduplication(apkg):
    """Ta sama tresc z dwoch roznych zrodel musi dac ten sam hash."""
    from_anki = normalize(parse("t.apkg", apkg), {"Przód": FIELD_FRONT, "Tył": FIELD_BACK})
    from_csv = normalize(
        parse("t.csv", "front,back\nubiquitous,wszechobecny\n".encode("utf-8")),
        {"front": FIELD_FRONT, "back": FIELD_BACK},
    )
    anki_hash = next(d["content_hash"] for d in from_anki if d["fields"][FIELD_FRONT] == "ubiquitous")
    assert anki_hash == from_csv[0]["content_hash"]
