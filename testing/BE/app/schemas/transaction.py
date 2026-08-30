import datetime as dt
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.category import CategoryType
from app.models.transaction import TransactionType
from app.schemas.common import Money


class CategoryMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: CategoryType


class TxCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "amount": "42.50",
                    "type": "expense",
                    "category_id": 1,
                    "description": "Weekly groceries",
                    "notes": "Supermarket run",
                    "date": "2026-03-14",
                }
            ]
        }
    )

    amount: Money
    type: TransactionType = Field(examples=["expense"])
    category_id: int | None = None
    description: str = Field(min_length=1, max_length=255, examples=["Weekly groceries"])
    notes: str | None = Field(default=None, max_length=2000)
    date: dt.date = Field(examples=["2026-03-14"])


class TxUpdate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"amount": "50.00", "description": "Groceries (updated)"}]}
    )

    amount: Money | None = None
    type: TransactionType | None = None
    category_id: int | None = None
    description: str | None = Field(default=None, min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    date: dt.date | None = None


class TxOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: Money
    type: TransactionType
    category_id: int | None
    category: CategoryMini | None = None
    description: str
    notes: str | None
    date: dt.date
    created_at: datetime
    updated_at: datetime
