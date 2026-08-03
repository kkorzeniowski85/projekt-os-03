"""CSV / TSV - najczestszy wspolny mianownik eksportow (Quizlet, arkusze, kursy)."""

import csv
import io

from app.importers.base import (
    ImportError_,
    ParseResult,
    SourceRow,
    is_known_header,
    looks_like_html,
    suggest_mapping,
    to_plain_text,
)

#: Separatory, ktore realnie wystepuja w eksportach fiszek.
_CANDIDATES = [",", ";", "\t", "|"]

MAX_ROWS = 20_000


def _decode(data: bytes) -> str:
    # Arkusze z Windows czesto wychodza w cp1250, a nie w UTF-8; utf-8-sig
    # zdejmuje BOM, ktory inaczej wladowalby sie w nazwe pierwszej kolumny.
    for encoding in ("utf-8-sig", "cp1250", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportError_("Nie udalo sie rozpoznac kodowania pliku.")


def _sniff_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters="".join(_CANDIDATES)).delimiter
    except csv.Error:
        # Sniffer lubi sie poddawac przy krotkich plikach - liczymy sami.
        counts = {d: sample.count(d) for d in _CANDIDATES}
        best = max(counts, key=lambda d: counts[d])
        if counts[best] == 0:
            raise ImportError_(
                "Nie wykryto separatora kolumn. Oczekiwano przecinka, srednika, "
                "tabulatora albo pionowej kreski."
            )
        return best


def _looks_like_header(row: list[str]) -> bool:
    """Czy pierwszy wiersz to naglowek, czy juz pierwsza fiszka.

    Wymagamy twardego dowodu: co najmniej jedna komorka musi byc rozpoznawalna
    nazwa kolumny ("front", "przod", "definition", ...).

    Rozwazalem `csv.Sniffer().has_header()`, ale ten glosuje po dlugosci
    komorek - dla pliku "kot;cat / pies;dog / ryba;fish" uznaje pierwszy wiersz
    za naglowek tylko dlatego, ze "kot" jest o znak krotsze od "pies". Kosztem
    bylaby zjedzona fiszka.

    Przy watpliwosci wygrywa wiec "to sa dane": zle nazwana kolumna jest widoczna
    w podgladzie i do poprawienia jednym przelacznikiem, a brakujaca fiszka jest
    niewidoczna - nikt jej nie szuka, bo nie wie, ze istniala.
    """
    if not row or any(not cell.strip() for cell in row):
        return False
    # Naglowki sa krotkie i nie koncza sie znakiem konca zdania.
    if not all(len(cell) <= 30 and not cell.rstrip().endswith((".", "?", "!")) for cell in row):
        return False
    return any(is_known_header(cell) for cell in row)


def parse(data: bytes, options: dict | None = None) -> ParseResult:
    options = options or {}
    text = _decode(data)
    if not text.strip():
        raise ImportError_("Plik jest pusty.")

    delimiter = _sniff_delimiter(text[:8192])
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)

    records = [row for row in reader if any(cell.strip() for cell in row)]
    if not records:
        raise ImportError_("Plik nie zawiera zadnych wierszy.")

    warnings: list[str] = []
    width = max(len(row) for row in records)

    # Jawne ustawienie z interfejsu wygrywa z domyslaniem sie.
    override = options.get("has_header")
    if override is None:
        has_header = _looks_like_header(records[0]) and len(records) > 1
    else:
        has_header = bool(override) and len(records) > 1

    if has_header:
        columns = [cell.strip() or f"kolumna {i + 1}" for i, cell in enumerate(records[0])]
        body = records[1:]
        warnings.append(
            f"Pierwszy wiersz potraktowano jako naglowek: {', '.join(columns)}. "
            "Jesli to juz fiszka, zmien ustawienie i wczytaj plik ponownie."
        )
    else:
        columns = [f"kolumna {i + 1}" for i in range(width)]
        body = records
        warnings.append(
            "Nie wykryto wiersza naglowka - kolumny ponumerowano, a wszystkie "
            f"{len(records)} wierszy potraktowano jako fiszki."
        )

    columns += [f"kolumna {i + 1}" for i in range(len(columns), width)]

    if len(body) > MAX_ROWS:
        warnings.append(f"Plik ma {len(body)} wierszy - zaimportowane zostanie pierwsze {MAX_ROWS}.")
        body = body[:MAX_ROWS]

    rows = [
        SourceRow(values={columns[i]: _cell(row[i] if i < len(row) else "") for i in range(len(columns))})
        for row in body
    ]

    if any(looks_like_html(cell) for row in body for cell in row):
        warnings.append(
            "Komorki zawieraly znaczniki HTML (typowe dla eksportu z Anki) - "
            "zostaly sprowadzone do czystego tekstu."
        )

    return ParseResult(
        source_format="csv",
        columns=columns,
        rows=rows,
        suggested_mapping=suggest_mapping(columns),
        warnings=warnings,
    )


def _cell(raw: str) -> str:
    """Komorka z eksportu potrafi zawierac cale <div style=...> - ekran nauki
    renderuje tresc doslownie, wiec znaczniki trzeba zdjac. Czyscimy tylko
    komorki z prawdziwym HTML-em, zeby nie zjesc tresci w rodzaju "a < b".
    """
    value = raw or ""
    return to_plain_text(value) if looks_like_html(value) else value.strip()
