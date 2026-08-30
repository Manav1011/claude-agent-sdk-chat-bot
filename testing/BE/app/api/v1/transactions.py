from datetime import date as date_type
from typing import Annotated, Literal

from fastapi import APIRouter, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DbDep
from app.core.errors import NotFound, Unprocessable
from app.models.category import Category
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.schemas.common import Page
from app.schemas.transaction import TxCreate, TxOut, TxUpdate

router = APIRouter(prefix="/transactions", tags=["transactions"])

SortField = Literal["date", "amount", "created_at"]


def _ilike_pattern(raw: str) -> str:
    escaped = raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def _validate_category(
    session: AsyncSession, user: User, category_id: int, tx_type: TransactionType
) -> Category:
    """Category must exist, belong to the user, and match the transaction type."""
    result = await session.execute(
        select(Category).where(Category.id == category_id, Category.user_id == user.id)
    )
    category = result.scalar_one_or_none()
    if category is None:
        raise NotFound("Category not found")
    if category.type.value != tx_type.value:
        raise Unprocessable(
            code="category_mismatch",
            message=f"Category '{category.name}' is {category.type.value} but transaction is {tx_type.value}",
        )
    return category


async def _get_owned_tx(tx_id: int, user_id: int, session: AsyncSession) -> Transaction:
    result = await session.execute(
        select(Transaction)
        .options(selectinload(Transaction.category))
        .where(Transaction.id == tx_id, Transaction.user_id == user_id)
    )
    tx = result.scalar_one_or_none()
    if tx is None:
        raise NotFound("Transaction not found")
    return tx


@router.get(
    "",
    response_model=Page[TxOut],
    summary="List transactions with filters, sorting and pagination",
)
async def list_transactions(
    current_user: CurrentUser,
    session: DbDep,
    category_id: Annotated[int | None, Query(description="Filter by category id")] = None,
    type: Annotated[TransactionType | None, Query(description="income or expense")] = None,  # noqa: A002
    date_from: Annotated[date_type | None, Query(description="Inclusive lower date bound")] = None,
    date_to: Annotated[date_type | None, Query(description="Inclusive upper date bound")] = None,
    q: Annotated[str | None, Query(description="Search in description and notes")] = None,
    sort: Annotated[SortField, Query(description="Sort column")] = "date",
    order: Annotated[Literal["asc", "desc"], Query(description="Sort direction")] = "desc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Page[TxOut]:
    conditions = [Transaction.user_id == current_user.id]
    if category_id is not None:
        conditions.append(Transaction.category_id == category_id)
    if type is not None:
        conditions.append(Transaction.type == type)
    if date_from is not None:
        conditions.append(Transaction.date >= date_from)
    if date_to is not None:
        conditions.append(Transaction.date <= date_to)
    if q:
        pattern = _ilike_pattern(q)
        conditions.append(or_(Transaction.description.ilike(pattern), Transaction.notes.ilike(pattern)))

    total = (
        await session.execute(select(func.count()).select_from(Transaction).where(*conditions))
    ).scalar_one()

    sort_col = {"date": Transaction.date, "amount": Transaction.amount, "created_at": Transaction.created_at}[sort]
    order_by = (sort_col.asc(), Transaction.id.asc()) if order == "asc" else (sort_col.desc(), Transaction.id.desc())

    rows = await session.execute(
        select(Transaction)
        .options(selectinload(Transaction.category))
        .where(*conditions)
        .order_by(*order_by)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [TxOut.model_validate(t) for t in rows.scalars().all()]
    return Page[TxOut](items=items, page=page, page_size=page_size, total=total)


@router.post(
    "",
    response_model=TxOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a transaction",
)
async def create_transaction(payload: TxCreate, current_user: CurrentUser, session: DbDep) -> TxOut:
    if payload.category_id is not None:
        await _validate_category(session, current_user, payload.category_id, payload.type)
    tx = Transaction(
        user_id=current_user.id,
        amount=payload.amount,
        type=payload.type,
        category_id=payload.category_id,
        description=payload.description,
        notes=payload.notes,
        date=payload.date,
    )
    session.add(tx)
    await session.flush()
    await session.refresh(tx, attribute_names=["category"])
    return TxOut.model_validate(tx)


@router.get("/{tx_id}", response_model=TxOut, summary="Get one transaction")
async def get_transaction(tx_id: int, current_user: CurrentUser, session: DbDep) -> TxOut:
    tx = await _get_owned_tx(tx_id, current_user.id, session)
    return TxOut.model_validate(tx)


@router.put("/{tx_id}", response_model=TxOut, summary="Update a transaction")
async def update_transaction(
    tx_id: int, payload: TxUpdate, current_user: CurrentUser, session: DbDep
) -> TxOut:
    tx = await _get_owned_tx(tx_id, current_user.id, session)
    fields = payload.model_fields_set

    if "category_id" in fields or "type" in fields:
        new_category_id = payload.category_id if "category_id" in fields else tx.category_id
        new_type = payload.type if "type" in fields else tx.type
        if new_category_id is not None:
            await _validate_category(session, current_user, new_category_id, new_type)

    for field in fields:
        setattr(tx, field, getattr(payload, field))
    await session.flush()
    await session.refresh(tx, attribute_names=["category"])
    return TxOut.model_validate(tx)


@router.delete(
    "/{tx_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a transaction",
)
async def delete_transaction(tx_id: int, current_user: CurrentUser, session: DbDep) -> None:
    tx = await _get_owned_tx(tx_id, current_user.id, session)
    await session.delete(tx)
    await session.flush()
