import calendar
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import case, func, select

from app.core.deps import CurrentUser, DbDep
from app.models.budget import Budget
from app.models.category import Category, CategoryType
from app.models.transaction import Transaction, TransactionType
from app.schemas.report import (
    BudgetVsActualItem,
    CategoryBreakdownItem,
    CategoryBreakdownOut,
    SummaryOut,
    TrendMonth,
    TrendsOut,
)

router = APIRouter(prefix="/reports", tags=["reports"])

CENT = Decimal("0.01")


def _month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end_day = calendar.monthrange(year, month)[1]
    return start, date(year, month, end_day)


def _pct(part: Decimal, whole: Decimal) -> Decimal:
    if whole == 0:
        return Decimal("0.00")
    return (part / whole * 100).quantize(CENT)


@router.get("/summary", response_model=SummaryOut, summary="Income/expense totals for a month")
async def summary(
    current_user: CurrentUser,
    session: DbDep,
    year: Annotated[int, Query(ge=1, le=2099)],
    month: Annotated[int, Query(ge=1, le=12)],
) -> SummaryOut:
    start, end = _month_range(year, month)
    row = (
        await session.execute(
            select(
                func.coalesce(
                    func.sum(case((Transaction.type == TransactionType.income, Transaction.amount), else_=0)),
                    Decimal("0"),
                ),
                func.coalesce(
                    func.sum(case((Transaction.type == TransactionType.expense, Transaction.amount), else_=0)),
                    Decimal("0"),
                ),
                func.count(),
            ).where(
                Transaction.user_id == current_user.id,
                Transaction.date >= start,
                Transaction.date <= end,
            )
        )
    ).one()
    income_total, expense_total, count = row[0], row[1], row[2]
    return SummaryOut(
        income_total=income_total,
        expense_total=expense_total,
        net=income_total - expense_total,
        transaction_count=count,
    )


@router.get(
    "/breakdown",
    response_model=CategoryBreakdownOut,
    summary="Per-category totals for a month with share of total",
)
async def breakdown(
    current_user: CurrentUser,
    session: DbDep,
    year: Annotated[int, Query(ge=1, le=2099)],
    month: Annotated[int, Query(ge=1, le=12)],
    type: Annotated[  # noqa: A002
        CategoryType, Query(description="Which side of the ledger to break down")
    ] = CategoryType.expense,
) -> CategoryBreakdownOut:
    tx_type = TransactionType(type.value)
    start, end = _month_range(year, month)
    rows = (
        await session.execute(
            select(
                Transaction.category_id,
                Category.name,
                func.sum(Transaction.amount).label("total"),
            )
            .outerjoin(Category, Category.id == Transaction.category_id)
            .where(
                Transaction.user_id == current_user.id,
                Transaction.type == tx_type,
                Transaction.date >= start,
                Transaction.date <= end,
            )
            .group_by(Transaction.category_id, Category.name)
        )
    ).all()

    grand_total = sum((row.total for row in rows), Decimal("0"))
    items = [
        CategoryBreakdownItem(
            category_id=row.category_id,
            category_name=row.name,
            total=row.total,
            pct_of_total=_pct(row.total, grand_total),
        )
        for row in rows
    ]
    items.sort(key=lambda item: item.total, reverse=True)
    return CategoryBreakdownOut(year=year, month=month, type=type, items=items)


@router.get(
    "/trends",
    response_model=TrendsOut,
    summary="Monthly income/expense totals for the last N months (zero-filled)",
)
async def trends(
    current_user: CurrentUser,
    session: DbDep,
    months: Annotated[
        int,
        Query(
            ge=1,
            le=24,
            description="Window size in months, ending with the current calendar month",
        ),
    ] = 6,
) -> TrendsOut:
    today = date.today()
    first_index = today.year * 12 + (today.month - 1) - (months - 1)
    month_keys = [((first_index + i) // 12, (first_index + i) % 12 + 1) for i in range(months)]
    start = date(month_keys[0][0], month_keys[0][1], 1)
    end_year, end_month = month_keys[-1]
    end = date(end_year, end_month, calendar.monthrange(end_year, end_month)[1])

    rows = (
        await session.execute(
            select(
                func.date_trunc("month", Transaction.date).label("month"),
                func.coalesce(
                    func.sum(case((Transaction.type == TransactionType.income, Transaction.amount), else_=0)),
                    Decimal("0"),
                ),
                func.coalesce(
                    func.sum(case((Transaction.type == TransactionType.expense, Transaction.amount), else_=0)),
                    Decimal("0"),
                ),
            )
            .where(
                Transaction.user_id == current_user.id,
                Transaction.date >= start,
                Transaction.date <= end,
            )
            .group_by("month")
        )
    ).all()
    totals = {(row.month.year, row.month.month): (row[1], row[2]) for row in rows}

    out: list[TrendMonth] = []
    for year, month in month_keys:
        income, expense = totals.get((year, month), (Decimal("0"), Decimal("0")))
        out.append(
            TrendMonth(
                year=year,
                month=month,
                income_total=income,
                expense_total=expense,
                net=income - expense,
            )
        )
    return TrendsOut(months=out)


@router.get(
    "/budget-status",
    response_model=list[BudgetVsActualItem],
    summary="Budget vs actual spending per category for a month",
)
async def budget_status(
    current_user: CurrentUser,
    session: DbDep,
    year: Annotated[int, Query(ge=1, le=2099)],
    month: Annotated[int, Query(ge=1, le=12)],
) -> list[BudgetVsActualItem]:
    start, end = _month_range(year, month)
    budgets = (
        await session.execute(
            select(Budget)
            .where(Budget.user_id == current_user.id, Budget.year == year, Budget.month == month)
            .order_by(Budget.category_id)
        )
    ).scalars().all()

    actual_rows = (
        await session.execute(
            select(Transaction.category_id, func.sum(Transaction.amount))
            .where(
                Transaction.user_id == current_user.id,
                Transaction.type == TransactionType.expense,
                Transaction.date >= start,
                Transaction.date <= end,
                Transaction.category_id.is_not(None),
            )
            .group_by(Transaction.category_id)
        )
    ).all()
    actual_by_category = {row[0]: row[1] for row in actual_rows}

    items = []
    for budget in budgets:
        actual = actual_by_category.get(budget.category_id, Decimal("0"))
        items.append(
            BudgetVsActualItem(
                budget_id=budget.id,
                category_name=budget.category.name,
                month=f"{year:04d}-{month:02d}",
                budgeted=budget.amount,
                actual=actual,
                remaining=budget.amount - actual,
                percent_used=_pct(actual, budget.amount),
            )
        )
    return items
