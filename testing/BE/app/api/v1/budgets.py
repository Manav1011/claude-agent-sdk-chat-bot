from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.deps import CurrentUser, DbDep
from app.core.errors import Conflict, NotFound, Unprocessable
from app.models.budget import Budget
from app.models.category import Category, CategoryType
from app.schemas.budget import BudgetCreate, BudgetOut, BudgetUpdate

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _to_out(budget: Budget) -> BudgetOut:
    out = BudgetOut.model_validate(budget)
    out.category_name = budget.category.name if budget.category is not None else None
    return out


async def _get_owned_budget(budget_id: int, user_id: int, session) -> Budget:
    result = await session.execute(
        select(Budget).where(Budget.id == budget_id, Budget.user_id == user_id)
    )
    budget = result.scalar_one_or_none()
    if budget is None:
        raise NotFound("Budget not found")
    return budget


@router.get(
    "",
    response_model=list[BudgetOut],
    summary="List budgets for a month (year and month required)",
)
async def list_budgets(
    current_user: CurrentUser,
    session: DbDep,
    year: Annotated[int, Query(ge=1, le=2099, description="Budget year")],
    month: Annotated[int, Query(ge=1, le=12, description="Budget month")],
) -> list[BudgetOut]:
    result = await session.execute(
        select(Budget)
        .where(Budget.user_id == current_user.id, Budget.year == year, Budget.month == month)
        .order_by(Budget.category_id)
    )
    return [_to_out(b) for b in result.scalars().all()]


@router.post(
    "",
    response_model=BudgetOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a monthly budget for a category",
)
async def create_budget(payload: BudgetCreate, current_user: CurrentUser, session: DbDep) -> BudgetOut:
    result = await session.execute(
        select(Category).where(Category.id == payload.category_id, Category.user_id == current_user.id)
    )
    category = result.scalar_one_or_none()
    if category is None:
        raise NotFound("Category not found")
    if category.type != CategoryType.expense:
        raise Unprocessable(code="not_an_expense_category", message="Budgets can only target expense categories")

    budget = Budget(
        user_id=current_user.id,
        category_id=payload.category_id,
        year=payload.year,
        month=payload.month,
        amount=payload.amount,
    )
    session.add(budget)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise Conflict(code="duplicate", message="A budget already exists for this category and month")
    return _to_out(budget)


@router.put("/{budget_id}", response_model=BudgetOut, summary="Update a budget amount")
async def update_budget(
    budget_id: int, payload: BudgetUpdate, current_user: CurrentUser, session: DbDep
) -> BudgetOut:
    budget = await _get_owned_budget(budget_id, current_user.id, session)
    budget.amount = payload.amount
    await session.flush()
    return _to_out(budget)


@router.delete(
    "/{budget_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a budget",
)
async def delete_budget(budget_id: int, current_user: CurrentUser, session: DbDep) -> None:
    budget = await _get_owned_budget(budget_id, current_user.id, session)
    await session.delete(budget)
    await session.flush()
