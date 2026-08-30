from decimal import Decimal
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, Field

# Money is always a Decimal with at most 2 decimal places, > 0, max 12 digits.
# Pydantic enforces decimal_places -> values like 1.234 are rejected with 422.
Money = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2, examples=["123.45"])]

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """Standard pagination envelope."""

    items: list[T]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
