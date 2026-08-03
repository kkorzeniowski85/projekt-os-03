import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    # 10 znakow zamiast typowych 8: przy zamknietej rejestracji rodzinnej i tak
    # nie ma presji na wygode, a taniej to zabezpieczyc teraz niz pozniej.
    password: str = Field(min_length=10, max_length=200)
    display_name: str = Field(min_length=1, max_length=100)
    invite_code: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    display_name: str
    desired_retention: float
    created_at: datetime
