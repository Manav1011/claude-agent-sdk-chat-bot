from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select

from app.core.deps import CurrentUser, DbDep
from app.core.errors import Conflict, Unauthorized
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.user import Token, UserCreate, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
)
async def register(payload: UserCreate, session: DbDep) -> UserOut:
    email = payload.email.lower()
    existing = await session.execute(select(User.id).where(User.email == email))
    if existing.scalar_one_or_none() is not None:
        raise Conflict(code="email_taken", message="Email already registered")
    user = User(email=email, password_hash=hash_password(payload.password))
    session.add(user)
    await session.flush()
    return UserOut.model_validate(user)


@router.post(
    "/login",
    response_model=Token,
    summary="Login (OAuth2 password form, email in username field)",
)
async def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], session: DbDep) -> Token:
    result = await session.execute(select(User).where(User.email == form.username.lower()))
    user = result.scalar_one_or_none()
    # Same message for unknown email and wrong password (no user enumeration).
    if user is None or not verify_password(form.password, user.password_hash):
        raise Unauthorized("Invalid email or password")
    if not user.is_active:
        raise Unauthorized("Account is disabled")
    return Token(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=UserOut, summary="Current authenticated user")
async def me(current_user: CurrentUser) -> UserOut:
    return UserOut.model_validate(current_user)
