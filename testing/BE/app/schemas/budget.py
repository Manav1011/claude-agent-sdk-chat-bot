from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Money


class BudgetCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"category_id": 1, "year": 2026, "month": 3, "amount": "400.00"}]
        }
    )

    category_id: int = Field(examples=[1])
    year: int = Field(ge=1, le=2099, examples=[2026])
    month: int = Field(ge=1, le=12, examples=[3])
    amount: Money


class BudgetUpdate(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"amount": "450.00"}]})

    amount: Money


class BudgetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    category_name: Optional[str] = None
    year: int
    month: int
    amount: Money
    created_at: datetime
    updated_at: datetime
