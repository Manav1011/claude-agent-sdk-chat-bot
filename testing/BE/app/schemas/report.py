from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.category import CategoryType


class SummaryOut(BaseModel):
    income_total: Decimal
    expense_total: Decimal
    net: Decimal
    transaction_count: int


class CategoryBreakdownItem(BaseModel):
    category_id: int | None = None
    category_name: str | None = None
    total: Decimal
    pct_of_total: Decimal = Field(description="Share of period total, 0-100")


class CategoryBreakdownOut(BaseModel):
    year: int
    month: int
    type: CategoryType
    items: list[CategoryBreakdownItem]


class TrendMonth(BaseModel):
    year: int
    month: int
    income_total: Decimal
    expense_total: Decimal
    net: Decimal


class TrendsOut(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "months": [
                        {
                            "year": 2026,
                            "month": 2,
                            "income_total": "0.00",
                            "expense_total": "0.00",
                            "net": "0.00",
                        },
                        {
                            "year": 2026,
                            "month": 3,
                            "income_total": "1000.00",
                            "expense_total": "575.00",
                            "net": "425.00",
                        },
                    ]
                }
            ]
        }
    )

    months: list[TrendMonth] = Field(
        description="Ascending (oldest first, newest last); months without transactions are zero-filled"
    )


class BudgetVsActualItem(BaseModel):
    budget_id: int
    category_name: str
    month: str = Field(description="Period as YYYY-MM", examples=["2026-03"])
    budgeted: Decimal
    actual: Decimal
    remaining: Decimal = Field(description="budgeted - actual; negative means overspend")
    percent_used: Decimal
