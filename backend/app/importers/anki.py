"""Import z Anki (.apkg / .colpkg).

Plik to ZIP z baza SQLite. Historycznie wystepuja trzy warianty skladowania:

  collection.anki2    - schemat 11, metadane (typy notatek, talie) jako JSON
                        w kolumnach tabeli `col`
  collection.anki21   - jak wyzej, nowszy harmonogram
  collection.anki21b  - schemat 18, skompresowany zstd, metadane w osobnych
                        tabelach `notetypes` / `fields` / `decks`

Obslugujemy wszystkie trzy. Tabela `notes` ma we wszystkich ten sam ksztalt:
pola sklejone znakiem \\x1f, tagi rozdzielone spacjami.

Czego NIE przenosimy (swiadomie):
  * media - obrazki i audio wymagaja warstwy plikow, ktorej jeszcze nie ma;
    fiszki z mediami wchodza jako sam tekst, z ostrzezeniem,
  * stanu powtorek - historia z Anki jest liczona innym algorytmem (SM-2),
    wiec przeniesienie jej udawaloby wiedze, ktorej FSRS nie potwierdzil.
    Karty startuja jako nowe.
"""

import html
import io
import json
import re
import sqlite3
import tempfile
import zipfile
from collections import Counter
from pathlib import Path

from app.importers.base import ImportError_, ParseResult, SourceRow, suggest_mapping

MAX_ROWS = 50_000

_DB_CANDIDATES = ("collection.anki21b", "collection.anki21", "collection.anki2")

_MEDIA_MARKER = re.compile(r"\[sound:|<img\s", re.IGNORECASE)
_BREAK = re.compile(r"<\s*(br|/div|/p|/li)\s*/?\s*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")
_SOUND = re.compile(r"\[sound:[^\]]*\]", re.IGNORECASE)


def _to_text(raw: str) -> str:
    """Pole Anki to HTML - sprowadzamy je do czystego tekstu."""
    without_sound = _SOUND.sub("", raw)
    with_newlines = _BREAK.sub("\n", without_sound)
    plain = html.unescape(_TAG.sub("", with_newlines))
    # Anki lubi twarde spacje; zostawione zafalszowalyby porownania i hashe.
    lines = [line.strip() for line in plain.replace("\xa0", " ").splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _extract_db(data: bytes) -> bytes:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ImportError_("Plik nie jest poprawnym archiwum .apkg.") from exc

    with archive:
        names = set(archive.namelist())
        member = next((c for c in _DB_CANDIDATES if c in names), None)
        if member is None:
            raise ImportError_(
                "W archiwum nie ma bazy kolekcji (collection.anki2 / .anki21 / .anki21b)."
            )
        payload = archive.read(member)

    if member.endswith("b"):
        payload = _decompress_zstd(payload)
    return payload


def _decompress_zstd(payload: bytes) -> bytes:
    try:
        import zstandard
    except ImportError as exc:  # pragma: no cover - zalezy od instalacji
        raise ImportError_(
            "Ten plik uzywa kompresji zstd. Doinstaluj pakiet 'zstandard' albo "
            "wyeksportuj talie z Anki z zaznaczona opcja zgodnosci ze starszymi wersjami."
        ) from exc
    try:
        return zstandard.ZstdDecompressor().decompress(payload, max_output_size=1 << 30)
    except zstandard.ZstdError as exc:
        raise ImportError_(f"Nie udalo sie rozpakowac bazy kolekcji: {exc}") from exc


def _load_metadata(db: sqlite3.Connection) -> tuple[dict[int, list[str]], dict[int, str], int]:
    """Zwraca (id typu notatki -> nazwy pol, id talii -> nazwa, wersja schematu)."""
    version = db.execute("SELECT ver FROM col").fetchone()[0]

    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    if "notetypes" in tables and "fields" in tables:
        # Schemat 18: metadane w tabelach.
        field_names: dict[int, list[str]] = {}
        for ntid, name, ord_ in db.execute(
            "SELECT ntid, name, ord FROM fields ORDER BY ntid, ord"
        ):
            field_names.setdefault(ntid, []).append(name)
        deck_names = {
            did: name.replace("\x1f", "::")
            for did, name in db.execute("SELECT id, name FROM decks")
        }
        return field_names, deck_names, version

    # Schemat 11: metadane jako JSON w tabeli `col`.
    models_json, decks_json = db.execute("SELECT models, decks FROM col").fetchone()
    models = json.loads(models_json or "{}")
    decks = json.loads(decks_json or "{}")

    field_names = {
        int(mid): [f["name"] for f in sorted(model.get("flds", []), key=lambda f: f["ord"])]
        for mid, model in models.items()
    }
    deck_names = {int(did): deck.get("name", "") for did, deck in decks.items()}
    return field_names, deck_names, version


def parse(data: bytes, options: dict | None = None) -> ParseResult:
    payload = _extract_db(data)
    warnings: list[str] = []

    with tempfile.TemporaryDirectory() as workdir:
        db_path = Path(workdir) / "collection.sqlite"
        db_path.write_bytes(payload)

        db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            field_names, deck_names, version = _load_metadata(db)

            # Notatka moze miec karty w roznych taliach; bierzemy talie karty
            # pierwszej. Sortowanie malejaco sprawia, ze ord=0 nadpisuje reszte.
            note_deck: dict[int, int] = {}
            for nid, did in db.execute("SELECT nid, did FROM cards ORDER BY ord DESC"):
                note_deck[nid] = did

            note_rows = db.execute("SELECT id, mid, tags, flds FROM notes").fetchall()
        except sqlite3.DatabaseError as exc:
            raise ImportError_(f"Nie udalo sie odczytac kolekcji: {exc}") from exc
        finally:
            db.close()

    if not note_rows:
        raise ImportError_("Kolekcja nie zawiera zadnych notatek.")

    if len(note_rows) > MAX_ROWS:
        warnings.append(
            f"Kolekcja ma {len(note_rows)} notatek - zaimportowane zostanie pierwsze {MAX_ROWS}."
        )
        note_rows = note_rows[:MAX_ROWS]

    # Kolumny bierzemy z dominujacego typu notatki. Pozostale mapujemy po
    # pozycji - inaczej kazdy typ dokladalby wlasny zestaw kolumn i mapowanie
    # stalo by sie nieczytelne.
    counts = Counter(mid for _, mid, _, _ in note_rows)
    dominant_mid, dominant_count = counts.most_common(1)[0]
    columns = list(field_names.get(dominant_mid) or [])

    width = max(len(flds.split("\x1f")) for _, _, _, flds in note_rows)
    if not columns:
        columns = [f"pole {i + 1}" for i in range(width)]
    columns += [f"pole {i + 1}" for i in range(len(columns), width)]

    if len(counts) > 1:
        warnings.append(
            f"Kolekcja zawiera {len(counts)} typow notatek. Kolumny pochodza z typu "
            f"najczestszego ({dominant_count} z {len(note_rows)} notatek); pozostale "
            "dopasowano po kolejnosci pol - sprawdz podglad."
        )

    media_notes = 0
    rows: list[SourceRow] = []

    for note_id, _mid, tags, flds in note_rows:
        raw_fields = flds.split("\x1f")
        if _MEDIA_MARKER.search(flds):
            media_notes += 1

        values = {
            columns[i]: _to_text(raw_fields[i]) if i < len(raw_fields) else ""
            for i in range(len(columns))
        }
        if not any(value.strip() for value in values.values()):
            continue

        deck_name = deck_names.get(note_deck.get(note_id, -1), "")
        rows.append(
            SourceRow(
                values=values,
                source_ref=f"anki:{note_id}",
                source_deck=deck_name or None,
                tags=[tag for tag in (tags or "").split(" ") if tag.strip()],
            )
        )

    if not rows:
        raise ImportError_("Zadna notatka nie zawierala tresci.")

    if media_notes:
        warnings.append(
            f"{media_notes} notatek zawiera obrazki lub dzwiek - zostana zaimportowane "
            "jako sam tekst. Obsluga mediow dojdzie pozniej."
        )
    warnings.append(
        "Stan powtorek z Anki nie jest przenoszony - karty startuja jako nowe. "
        "Anki liczy je algorytmem SM-2, ktorego FSRS nie potrafi wiarygodnie przejac."
    )

    return ParseResult(
        source_format="anki",
        columns=columns,
        rows=rows,
        suggested_mapping=suggest_mapping(columns),
        warnings=warnings,
        source_decks=sorted({r.source_deck for r in rows if r.source_deck}),
    )
