from datetime import datetime, timedelta, timezone
from typing import Any

import jose.jwt
from passlib.context import CryptContext

from app.core.config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, expires_minutes: int | None = None) -> str:
    settings = get_settings()
    minutes = expires_minutes if expires_minutes is not None else settings.ACCESS_TOKEN_EXPIRE_MINUTES
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "exp": now + timedelta(minutes=minutes),
        "iat": now,
    }
    return jose.jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT. Raises jose exceptions on failure."""
    settings = get_settings()
    return jose.jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
