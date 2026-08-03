import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.decks import get_owned_deck
from app.core.security import get_current_user
from app.db import get_db
from app.importers import FORMATS, MAPPING_TARGETS, ImportError_, cap_warnings
from app.importers import parse as parse_source
from app.models import ImportJob, ImportStatus, NoteType, User
from app.schemas.importing import (
    AnalyzeOut,
    CommitIn,
    CommitOut,
    DuplicateSummary,
    FormatOut,
    NoteDraftOut,
)
from app.services import importing

router = APIRouter(prefix="/import", tags=["import"])

#: Zabezpieczenie przed przypadkowym wrzuceniem czegos, co nie jest talia.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


@router.get("/formats", response_model=list[FormatOut])
def list_formats() -> list[FormatOut]:
    return [
        FormatOut(
            key=fmt.key,
            label=fmt.label,
            extensions=list(fmt.extensions),
            description=fmt.description,
        )
        for fmt in FORMATS
    ]


@router.post("/analyze", response_model=AnalyzeOut)
async def analyze(
    file: UploadFile | None = File(default=None),
    content: str | None = Form(default=None),
    filename: str | None = Form(default=None),
    source_format: str | None = Form(default=None),
    #: Nadpisuje wykrywanie naglowka w CSV/TSV. Potrzebne, bo przy pliku w
    #: rodzaju "kot;cat" nie da sie odroznic naglowka od danych, a pomylka
    #: kasuje pierwsza fiszke.
    has_header: bool | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnalyzeOut:
    """Faza pierwsza: parsuje zrodlo i proponuje mapowanie. Nic nie zapisuje do talii."""
    if file is not None:
        data = await file.read()
        name = filename or file.filename or "import"
    elif content:
        data = content.encode("utf-8")
        name = filename or "wklejone.txt"
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nie przeslano ani pliku, ani tresci")

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Plik przekracza {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
        )
    if not data.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Zrodlo jest puste")

    try:
        result = parse_source(name, data, source_format, {"has_header": has_header})
    except ImportError_ as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    warnings = cap_warnings(result.warnings)

    drafts = importing.normalize(result, result.suggested_mapping)
    if not drafts:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Przy sugerowanym mapowaniu nie powstala zadna fiszka - sprawdz, czy plik ma "
            "kolumny z przodem i tylem",
        )

    job = ImportJob(
        user_id=user.id,
        source_format=result.source_format,
        filename=name,
        status=ImportStatus.ANALYZED,
        analysis={
            "columns": result.columns,
            "warnings": warnings,
            "source_decks": result.source_decks,
            "suggested_note_type": result.suggested_note_type.value,
        },
        mapping=result.suggested_mapping,
        # Trzymamy surowe wiersze, a nie znormalizowane notatki: uzytkownik
        # moze zmienic mapowanie przed zatwierdzeniem, wiec normalizacja musi
        # dac sie powtorzyc.
        items=[
            {
                "values": row.values,
                "source_ref": row.source_ref,
                "source_deck": row.source_deck,
                "tags": row.tags,
                "note_type": row.note_type.value if row.note_type else None,
            }
            for row in result.rows
        ],
        total_items=len(result.rows),
    )
    db.add(job)
    db.commit()

    return AnalyzeOut(
        job_id=job.id,
        filename=name,
        source_format=result.source_format,
        columns=result.columns,
        suggested_mapping=result.suggested_mapping,
        mapping_targets=list(MAPPING_TARGETS),
        suggested_note_type=result.suggested_note_type,
        source_decks=result.source_decks,
        warnings=warnings,
        total_items=len(drafts),
        preview=[NoteDraftOut(**_draft_out(d)) for d in importing.preview(drafts)],
        duplicates=DuplicateSummary(**importing.duplicate_summary(db, user, drafts)),
    )


@router.post("/{job_id}/commit", response_model=CommitOut)
def commit(
    job_id: uuid.UUID,
    payload: CommitIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommitOut:
    """Faza druga: stosuje zatwierdzone mapowanie i tworzy notatki."""
    job = db.scalar(select(ImportJob).where(ImportJob.id == job_id, ImportJob.user_id == user.id))
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nie znaleziono zadania importu")
    if job.status != ImportStatus.ANALYZED:
        raise HTTPException(status.HTTP_409_CONFLICT, "To zadanie zostalo juz zamkniete")

    deck = get_owned_deck(payload.deck_id, db, user)

    unknown = set(payload.mapping.values()) - set(MAPPING_TARGETS)
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Nieznane cele mapowania: {', '.join(sorted(unknown))}"
        )

    drafts = importing.normalize(
        _result_from_job(job), payload.mapping, default_kind=payload.default_item_kind
    )
    if not drafts:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Przy tym mapowaniu nie powstala zadna fiszka - upewnij sie, ze wskazano "
            "kolumny dla przodu i tylu",
        )

    stats = importing.commit(
        db,
        user,
        deck,
        drafts,
        note_type=payload.note_type,
        skip_duplicates=payload.skip_duplicates,
    )

    job.deck_id = deck.id
    job.mapping = payload.mapping
    job.status = ImportStatus.COMMITTED
    job.imported_count = stats.imported
    job.skipped_count = stats.skipped_duplicates + stats.skipped_invalid
    job.committed_at = datetime.now(timezone.utc)
    # Surowe wiersze nie sa juz potrzebne, a potrafia wazyc megabajty.
    job.items = []
    db.commit()

    return CommitOut(
        job_id=job.id,
        deck_id=deck.id,
        imported=stats.imported,
        skipped_duplicates=stats.skipped_duplicates,
        skipped_invalid=stats.skipped_invalid,
        total_items=len(drafts),
    )


@router.post("/{job_id}/preview", response_model=list[NoteDraftOut])
def repreview(
    job_id: uuid.UUID,
    mapping: dict[str, str],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[NoteDraftOut]:
    """Podglad przy zmienionym mapowaniu - zanim uzytkownik zatwierdzi import."""
    job = db.scalar(select(ImportJob).where(ImportJob.id == job_id, ImportJob.user_id == user.id))
    if job is None or job.status != ImportStatus.ANALYZED:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nie znaleziono aktywnego zadania importu")

    drafts = importing.normalize(_result_from_job(job), mapping)
    return [NoteDraftOut(**_draft_out(d)) for d in importing.preview(drafts)]


def _result_from_job(job: ImportJob):
    """Odtwarza ParseResult z tego, co zapisano w fazie analizy."""
    from app.importers.base import ParseResult, SourceRow

    return ParseResult(
        source_format=job.source_format,
        columns=list(job.analysis.get("columns") or []),
        rows=[
            SourceRow(
                values=item.get("values") or {},
                source_ref=item.get("source_ref"),
                source_deck=item.get("source_deck"),
                tags=list(item.get("tags") or []),
                note_type=_note_type_or_none(item.get("note_type")),
            )
            for item in (job.items or [])
        ],
        suggested_mapping=job.mapping or {},
    )


def _note_type_or_none(value: str | None) -> NoteType | None:
    if not value:
        return None
    try:
        return NoteType(value)
    except ValueError:
        return None


def _draft_out(draft: dict) -> dict:
    return {
        "fields": draft["fields"],
        "tags": draft["tags"],
        "item_kind": draft["item_kind"],
        "source_deck": draft.get("source_deck"),
        "note_type": draft.get("note_type"),
    }
