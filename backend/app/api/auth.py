from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.limiter import limiter
from app.core.security import (
    create_access_token,
    get_current_user,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    verify_password,
)
from app.db import get_db
from app.models import Deck, RefreshToken, User
from app.schemas.auth import LoginIn, RegisterIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

REFRESH_COOKIE = "refresh_token"


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=raw_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.refresh_token_days * 24 * 3600,
        path="/api/auth",
    )


def _issue_refresh_token(db: Session, user: User, response: Response) -> None:
    raw, token_hash = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.refresh_token_days),
        )
    )
    _set_refresh_cookie(response, raw)


def _access_token_out(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user.id),
        expires_in=settings.access_token_minutes * 60,
    )


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
def register(
    request: Request,
    payload: RegisterIn,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenOut:
    # Rejestracja zamknieta - to narzedzie dla kilku osob, nie otwarty serwis.
    if payload.invite_code != settings.invite_code:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Nieprawidlowy kod zaproszenia")

    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Konto z tym adresem juz istnieje")

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
    )
    db.add(user)
    db.flush()

    # Pusta aplikacja bez zadnej talii jest slepym zaulkiem - dajemy jedna na start.
    db.add(Deck(user_id=user.id, name="Moja pierwsza talia"))

    _issue_refresh_token(db, user, response)
    db.commit()
    return _access_token_out(user)


@router.post("/login", response_model=TokenOut)
@limiter.limit("10/minute")
def login(
    request: Request,
    payload: LoginIn,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenOut:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    # Ten sam komunikat i ta sama sciezka niezaleznie od tego, czy zawiodl email
    # czy haslo - inaczej endpoint zdradza, ktore adresy istnieja.
    if user is None or not user.is_active or not verify_password(user.password_hash, payload.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Nieprawidlowy email lub haslo")

    _issue_refresh_token(db, user, response)
    db.commit()
    return _access_token_out(user)


@router.post("/refresh", response_model=TokenOut)
@limiter.limit("60/minute")
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenOut:
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Brak refresh tokenu")

    token = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw))
    )
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Nieprawidlowy refresh token")

    now = datetime.now(timezone.utc)
    if token.revoked_at is not None:
        # Zuzyty token wrocil - albo ktos go przechwycil, albo klient sie zapetlil.
        # Bezpieczniej uniewaznic cala rodzine tokenow i wymusic ponowne logowanie.
        db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == token.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        db.commit()
        response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token byl juz uzyty - zaloguj sie ponownie")

    if token.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token wygasl")

    user = db.get(User, token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Konto nieaktywne")

    token.revoked_at = now  # rotacja przy kazdym uzyciu
    _issue_refresh_token(db, user, response)
    db.commit()
    return _access_token_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.token_hash == hash_refresh_token(raw),
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(timezone.utc))
        )
        db.commit()
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
