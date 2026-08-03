from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "zmien-mnie-przed-produkcja"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    environment: str = "dev"

    database_url: str = "postgresql+psycopg://fiszki:fiszki@localhost:5432/fiszki"

    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    # Rejestracja jest zamknieta: bez tego kodu /auth/register odmawia.
    invite_code: str = "rodzina"

    cors_origins: list[str] = ["http://localhost:3000"]

    # Refresh token jedzie w ciasteczku httpOnly. Na produkcji (HTTPS) ustaw
    # cookie_secure=true; na http://localhost przegladarka odrzucilaby Secure.
    cookie_secure: bool = False
    cookie_samesite: str = "lax"

    # Godzina (UTC), o ktorej zaczyna sie "nowy dzien nauki". Anki uzywa 4:00
    # lokalnego czasu; tu na razie liczymy w UTC - patrz docs/adr/0003.
    day_rollover_hour: int = 4

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"prod", "production"}


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.is_production and settings.jwt_secret == DEFAULT_JWT_SECRET:
        raise RuntimeError(
            "JWT_SECRET nie zostal ustawiony, a ENVIRONMENT=prod. "
            "Wygeneruj sekret: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    return settings
