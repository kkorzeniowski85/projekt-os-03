from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import auth, decks, imports, notes, stats, study
from app.config import get_settings
from app.core.limiter import limiter

settings = get_settings()


def unique_id(route: APIRoute) -> str:
    # Czytelne nazwy w OpenAPI -> czytelne typy generowane dla frontendu.
    return f"{route.tags[0]}_{route.name}" if route.tags else route.name


app = FastAPI(
    title="Fiszki API",
    version="0.1.0",
    generate_unique_id_function=unique_id,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # jawna lista - wymagane przy credentials
    allow_credentials=True,  # refresh token jedzie w ciasteczku httpOnly
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    auth.router,
    decks.router,
    notes.router,
    study.router,
    imports.router,
    stats.router,
):
    app.include_router(router, prefix="/api")


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}
