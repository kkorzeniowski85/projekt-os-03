"""Konwertuje trackery OET (pliki .jsx) na talie w formacie fiszki/v1.

    python backend/scripts/convert_oet.py <plik.jsx> [<plik.jsx> ...] [-o katalog]

Zrodlem sa dwa artefakty z projektu OET Preparation:

  vocabulary-tracker.jsx          -> ALL_PHRASES (chunk/ipa/polish/register/formal)
  medical-vocabulary-tracker.jsx  -> ALL_TERMS   (term/polish/context/synonyms)

Dane sa juz uporzadkowane, wiec nie zgadujemy niczego poza kategoria materialu.
Wynik przechodzi przez prawdziwy parser importu, wiec to, co skrypt wypisze,
jest tym, co zobaczy aplikacja - a nie tym, co skrypt sadzi, ze zobaczy.

Parsowanie: pliki to JavaScript, nie JSON. Nie zamieniamy ich na JSON przez
podstawianie cudzyslowow w kluczach, bo przecinek albo dwukropek w srodku
zdania przykladowego cicho rozjechalby caly rekord. Zamiast tego tniemy tekst
po znacznikach `id:"..."` i z kazdego kawalka wyciagamy pola po nazwie.
"""

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.importers import parse as parse_source  # noqa: E402
from app.services.importing import normalize  # noqa: E402

# --- odczyt zrodla ---------------------------------------------------------

_ID = re.compile(r'\bid\s*:\s*"([^"]+)"')


def _field(chunk: str, name: str) -> str:
    match = re.search(rf'\b{name}\s*:\s*"((?:[^"\\]|\\.)*)"', chunk)
    return _unescape(match.group(1)) if match else ""


def _examples(chunk: str) -> list[str]:
    match = re.search(r"\bexamples\s*:\s*\[(.*?)\]", chunk, re.S)
    if not match:
        return []
    return [_unescape(m) for m in re.findall(r'"((?:[^"\\]|\\.)*)"', match.group(1))]


def _unescape(raw: str) -> str:
    return raw.replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\").strip()


def read_records(path: Path) -> list[dict]:
    """Tnie plik na rekordy po `id:"..."` i wyciaga z kazdego znane pola."""
    text = path.read_text(encoding="utf-8")
    marks = list(_ID.finditer(text))
    if not marks:
        raise SystemExit(f"{path.name}: nie znalazlem zadnego wpisu (brak 'id:').")

    records = []
    for index, mark in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        chunk = text[mark.start() : end]
        records.append(
            {
                "id": mark.group(1),
                "category": _field(chunk, "category"),
                "chunk": _field(chunk, "chunk"),
                "term": _field(chunk, "term"),
                "ipa": _field(chunk, "ipa"),
                "polish": _field(chunk, "polish"),
                "register": _field(chunk, "register"),
                "formal": _field(chunk, "formal"),
                "context": _field(chunk, "context"),
                "synonyms": _field(chunk, "synonyms"),
                "examples": _examples(chunk),
            }
        )
    return records


# --- decyzje o fiszce ------------------------------------------------------

#: Etykiety rejestru wprost z trackera (REGISTER_CONFIG).
REGISTER_LABEL = {
    "neutral": "aktywny",
    "medical": "medyczny",
    "med-slang": "med-slang",
    "passive": "nieformalne",
}

#: Typ notatki wynika z tego, co ze zwrotem wolno zrobic na egzaminie.
#:
#: "nieformalne" tracker opisuje wprost jako "codziennosc i koledzy, nie OET",
#: a med-slang to mowa wewnetrzna oddzialu. Takie zwroty trzeba ROZUMIEC, ale
#: cwiczenie ich produkcji uczyloby odruchu, ktory na egzaminie szkodzi -
#: dlatego jedna karta (rozpoznawanie), nie dwie.
REGISTER_NOTE_TYPE = {
    "neutral": "basic_reversed",
    "medical": "basic_reversed",
    "med-slang": "basic",
    "passive": "basic",
}

CATEGORY_TAG = {"london": "codziennosc", "nhs": "nhs"}

#: Kategoria materialu dla terminow z drugiego trackera. Ustawiona recznie,
#: bo zbior jest maly, a roznica "termin techniczny" vs "utarta formula raportu"
#: jest dla statystyk istotna i zadna heurystyka jej nie zlapie.
TERM_KIND = {
    "m1": "word", "m2": "word", "m3": "word", "m4": "word", "m5": "word",
    "m6": "expression", "m7": "phrase", "m8": "expression", "m9": "expression",
    "m10": "expression", "m11": "expression", "m12": "expression",
    "m13": "expression", "m14": "word", "m15": "word", "m16": "phrase",
    "m17": "expression",
}

_LEADING = re.compile(r"^(to|a|an|the)\s+", re.IGNORECASE)
_PARENS = re.compile(r"\([^)]*\)")


def phrase_kind(chunk: str, register: str) -> str:
    """Kategoria materialu dla zwrotu z pierwszego trackera.

    Tracker zbiera swiadomie "chunki" - zwroty, ktorych znaczenia nie sklada sie
    ze slow skladowych. Domyslnie jest to wiec `expression`, a nie `phrase`;
    wyjatkiem sa pojedyncze slowa i terminy czysto medyczne.
    """
    bare = _PARENS.sub("", chunk)
    bare = _LEADING.sub("", bare).strip(" …/")
    tokens = [t for t in re.split(r"[\s/]+", bare) if t]
    if len(tokens) <= 1:
        return "word"
    if register == "medical":
        return "phrase"
    return "expression"


def slug(value: str) -> str:
    stripped = unicodedata.normalize("NFKD", value.lower())
    ascii_only = "".join(c for c in stripped if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")[:60]


def note_from_phrase(record: dict) -> dict:
    """Zwrot -> notatka. Front i tyl zostaja czyste, reszta idzie w przyklad.

    Odpowiednik formalny i wymowa NIE wchodza do tylu, bo tyl jest jednoczesnie
    pytaniem karty odwrotnej (polski -> angielski). Podpowiedz w pytaniu
    zepsulaby cwiczenie produkcji.
    """
    register = record["register"] or "neutral"
    lines = []
    if record["ipa"]:
        lines.append(record["ipa"])
    if record["formal"]:
        lines.append(f"Formalnie (OET): {record['formal']}")
    if lines and record["examples"]:
        lines.append("")
    lines.extend(record["examples"])

    tags = ["oet", REGISTER_LABEL.get(register, register)]
    if record["category"] in CATEGORY_TAG:
        tags.append(CATEGORY_TAG[record["category"]])

    return {
        "front": record["chunk"],
        "back": record["polish"],
        "example": "\n".join(lines),
        "tags": tags,
        "kind": phrase_kind(record["chunk"], register),
        "note_type": REGISTER_NOTE_TYPE.get(register, "basic_reversed"),
        "source_ref": f"oet-frazy/{record['id']}/{slug(record['chunk'])}",
    }


CONTEXT_TAG = {
    "report": "raport",
    "letter": "list",
    "notes": "notatki",
    "patient talk": "rozmowa-z-pacjentem",
}


def note_from_term(record: dict) -> dict:
    lines = []
    if record["synonyms"]:
        lines.append(f"Synonimy: {record['synonyms']}")
    if lines and record["examples"]:
        lines.append("")
    lines.extend(record["examples"])

    tags = ["oet", "terminologia"]
    for part in record["context"].split("/"):
        label = CONTEXT_TAG.get(part.strip())
        if label:
            tags.append(label)

    return {
        "front": record["term"],
        "back": record["polish"],
        "example": "\n".join(lines),
        "tags": tags,
        "kind": TERM_KIND.get(record["id"], "phrase"),
        # Terminologia raportowa to material do czynnego uzycia w pisaniu,
        # wiec oba kierunki.
        "note_type": "basic_reversed",
        "source_ref": f"oet-terminy/{record['id']}/{slug(record['term'])}",
    }


# --- talie -----------------------------------------------------------------

DECKS = [
    ("oet-codziennosc.json", "OET — codzienność (Londyn)",
     lambda r: r["chunk"] and r["category"] == "london", note_from_phrase),
    ("oet-nhs.json", "OET — NHS i oddział",
     lambda r: r["chunk"] and r["category"] == "nhs", note_from_phrase),
    ("oet-terminologia.json", "OET — terminologia i zwroty formalne",
     lambda r: bool(r["term"]), note_from_term),
]


def build(records: list[dict], out_dir: Path) -> list[tuple[Path, dict]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []

    for filename, deck_name, matches, to_note in DECKS:
        selected = [r for r in records if matches(r)]
        if not selected:
            continue

        notes, skipped = [], []
        for record in selected:
            note = to_note(record)
            if not note["front"].strip() or not note["back"].strip():
                skipped.append(record["id"])
                continue
            notes.append({k: v for k, v in note.items() if v not in ("", [], None)})

        payload = {
            "format": "fiszki/v1",
            "deck": deck_name,
            "default_note_type": "basic_reversed",
            "notes": notes,
        }
        path = out_dir / filename
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        written.append((path, {"notes": notes, "skipped": skipped}))

    return written


def verify(path: Path) -> dict:
    """Puszcza gotowy plik przez prawdziwy importer aplikacji."""
    result = parse_source(path.name, path.read_bytes())
    drafts = normalize(result, result.suggested_mapping)
    hashes = [d["content_hash"] for d in drafts]
    return {
        "format": result.source_format,
        "drafts": drafts,
        "warnings": result.warnings,
        "duplicates": len(hashes) - len(set(hashes)),
        "cards": sum(2 if d.get("note_type") == "basic_reversed" else 1 for d in drafts),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("-o", "--out", type=Path, default=Path("talie"))
    args = parser.parse_args()

    records = []
    for source in args.sources:
        if not source.exists():
            print(f"BLAD: nie ma pliku {source}")
            return 1
        found = read_records(source)
        print(f"{source.name}: {len(found)} wpisow")
        records.extend(found)

    print()
    total_notes = total_cards = 0
    for path, info in build(records, args.out):
        check = verify(path)
        drafts = check["drafts"]
        kinds = Counter(d["item_kind"] for d in drafts)
        types = Counter(d.get("note_type") or "basic" for d in drafts)

        print(f"{path}")
        print(f"  notatek: {len(drafts)}   kart po imporcie: {check['cards']}")
        print(f"  kategorie: {dict(kinds)}")
        print(f"  typy: {dict(types)}")
        if check["duplicates"]:
            print(f"  duplikaty w pliku: {check['duplicates']}")
        if info["skipped"]:
            print(f"  POMINIETE (brak przodu albo tylu): {', '.join(info['skipped'])}")
        for warning in check["warnings"]:
            print(f"  uwaga: {warning}")
        print()

        total_notes += len(drafts)
        total_cards += check["cards"]

    print(f"RAZEM: {total_notes} notatek -> {total_cards} kart")
    print("Kazdy plik przeszedl przez parser importu aplikacji.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
