"""Zamiana (notatka, numer szablonu) na konkretne pytanie i odpowiedz.

W MVP szablony sa zaszyte w kodzie. Gdy pojawia sie konfigurowalne typy notatek,
to jest jedyne miejsce do wymiany na prawdziwy silnik szablonow.
"""

from app.models import Note, NoteType

FIELD_FRONT = "Front"
FIELD_BACK = "Back"
#: Zdanie przykladowe. Opcjonalne, ale przy nauce jezyka to roznica miedzy
#: zapamietaniem tlumaczenia a zapamietaniem uzycia - wiec ma wlasne pole,
#: a nie doklejane do tylu fiszki.
FIELD_EXAMPLE = "Example"

#: Pola, ktore aplikacja rozumie. Import mapuje na nie kolumny zrodla.
KNOWN_FIELDS = (FIELD_FRONT, FIELD_BACK, FIELD_EXAMPLE)


def render(note: Note, template_ord: int) -> tuple[str, str]:
    front = (note.fields or {}).get(FIELD_FRONT, "")
    back = (note.fields or {}).get(FIELD_BACK, "")

    if note.note_type == NoteType.BASIC_REVERSED and template_ord == 1:
        return back, front
    return front, back


def example(note: Note) -> str:
    return (note.fields or {}).get(FIELD_EXAMPLE, "")


def template_label(note_type: NoteType, template_ord: int) -> str:
    if note_type == NoteType.BASIC_REVERSED and template_ord == 1:
        return f"{FIELD_BACK} → {FIELD_FRONT}"
    return f"{FIELD_FRONT} → {FIELD_BACK}"
