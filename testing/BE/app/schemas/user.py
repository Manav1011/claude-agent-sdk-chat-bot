from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

USER_EXAMPLE = {"email": "user@example.com", "password": "supersecret123"}


class UserCreate(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [USER_EXAMPLE]})

    email: EmailStr
    # bcrypt truncates/raises past 72 bytes; 72 is the real ceiling (plan said 128).
    password: str = Field(min_length=8, max_length=72, examples=["supersecret123"])


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    is_active: bool
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
