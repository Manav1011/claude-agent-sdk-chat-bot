from typing import Annotated

from jose import JWTError
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import Unauthorized
from app.core.security import decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    session: DbDep,
) -> User:
    try:
        payload = decode_token(token)
        user_id = payload["sub"]
    except (JWTError, KeyError, ValueError):
        raise Unauthorized("Could not validate credentials")

    result = await session.execute(select(User).where(User.id == int(user_id), User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        raise Unauthorized("Could not validate credentials")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
