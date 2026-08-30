from fastapi import APIRouter, status
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError

from app.core.deps import CurrentUser, DbDep
from app.core.errors import Conflict, NotFound
from app.models.budget import Budget
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.category import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


async def _get_owned_category(category_id: int, user_id: int, session) -> Category:
    result = await session.execute(
        select(Category).where(Category.id == category_id, Category.user_id == user_id)
    )
    category = result.scalar_one_or_none()
    if category is None:
        raise NotFound("Category not found")
    return category


@router.get("", response_model=list[CategoryOut], summary="List all categories of the current user")
async def list_categories(current_user: CurrentUser, session: DbDep) -> list[CategoryOut]:
    result = await session.execute(
        select(Category).where(Category.user_id == current_user.id).order_by(Category.name)
    )
    return [CategoryOut.model_validate(c) for c in result.scalars().all()]


@router.post(
    "",
    response_model=CategoryOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a category",
)
async def create_category(payload: CategoryCreate, current_user: CurrentUser, session: DbDep) -> CategoryOut:
    category = Category(user_id=current_user.id, name=payload.name, type=payload.type)
    session.add(category)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise Conflict(code="duplicate", message="A category with this name already exists")
    return CategoryOut.model_validate(category)


@router.get("/{category_id}", response_model=CategoryOut, summary="Get one category")
async def get_category(category_id: int, current_user: CurrentUser, session: DbDep) -> CategoryOut:
    category = await _get_owned_category(category_id, current_user.id, session)
    return CategoryOut.model_validate(category)


@router.put("/{category_id}", response_model=CategoryOut, summary="Update a category")
async def update_category(
    category_id: int, payload: CategoryUpdate, current_user: CurrentUser, session: DbDep
) -> CategoryOut:
    category = await _get_owned_category(category_id, current_user.id, session)
    if payload.name is not None:
        category.name = payload.name
    if payload.type is not None:
        category.type = payload.type
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise Conflict(code="duplicate", message="A category with this name already exists")
    return CategoryOut.model_validate(category)


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a category (409 if referenced)",
)
async def delete_category(category_id: int, current_user: CurrentUser, session: DbDep) -> None:
    category = await _get_owned_category(category_id, current_user.id, session)
    tx_used = await session.execute(
        select(exists().where(Transaction.category_id == category_id))
    )
    budget_used = await session.execute(
        select(exists().where(Budget.category_id == category_id))
    )
    if tx_used.scalar() or budget_used.scalar():
        raise Conflict(
            code="in_use",
            message="Category is referenced by transactions or budgets and cannot be deleted",
        )
    await session.delete(category)
    await session.flush()
