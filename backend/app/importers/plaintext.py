"""Zwykly tekst: jedna fiszka na linie, przod i tyl rozdzielone separatorem.

Format do szybkiego wklejenia listy - nie kazde zrodlo warto najpierw
przerabiac na CSV.
"""

from app.importers.base import ImportError_, ParseResult, SourceRow, suggest_mapping

COLUMN_FRONT = "przod"
COLUMN_BACK = "tyl"

#: Kolejnosc ma znaczenie - tabulator jest jednoznaczny, myslnik bywa czescia
#: tresci, wiec wymaga spacji po obu stronach.
_SEPARATORS = ["\t", " — ", " – ", " - ", " = ", " | ", ";"]

MAX_ROWS = 20_000


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1250", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportError_("Nie udalo sie rozpoznac kodowania pliku.")


def parse(data: bytes, options: dict | None = None) -> ParseResult:
    lines = [line.strip() for line in _decode(data).splitlines()]
    lines = [line for line in lines if line and not line.startswith("#")]
    if not lines:
        raise ImportError_("Plik nie zawiera zadnych linii z trescia.")

    # Wybieramy separator, ktory dzieli najwiecej linii dokladnie na dwie czesci.
    scored = {sep: sum(1 for line in lines if line.count(sep) >= 1) for sep in _SEPARATORS}
    separator = max(scored, key=lambda s: scored[s])
    if scored[separator] == 0:
        raise ImportError_(
            "Nie wykryto separatora. Oczekiwano tabulatora albo myslnika ze spacjami "
            "(np. 'kot - cat')."
        )

    warnings: list[str] = []
    rows: list[SourceRow] = []
    skipped = 0

    for line in lines[:MAX_ROWS]:
        front, found, back = line.partition(separator)
        if not found or not front.strip() or not back.strip():
            skipped += 1
            continue
        rows.append(
            SourceRow(values={COLUMN_FRONT: front.strip(), COLUMN_BACK: back.strip()})
        )

    if skipped:
        warnings.append(f"Pominieto {skipped} linii bez separatora albo z pusta strona.")
    if not rows:
        raise ImportError_("Zadna linia nie dala sie podzielic na przod i tyl.")

    columns = [COLUMN_FRONT, COLUMN_BACK]
    return ParseResult(
        source_format="text",
        columns=columns,
        rows=rows,
        suggested_mapping=suggest_mapping(columns),
        warnings=warnings,
    )
