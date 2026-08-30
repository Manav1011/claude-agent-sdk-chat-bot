"""Direct database-level assertions that the plan's constraints exist in the schema.

Each test commits its setup in one transaction, then attempts the forbidden
statement in its own transaction so the aborted transaction is rolled back
without poisoning the connection.
"""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine


async def _insert_user(conn, email: str) -> int:
    result = await conn.execute(
        text("INSERT INTO users (email, password_hash) VALUES (:e, 'x') RETURNING id"),
        {"e": email},
    )
    return result.scalar_one()


async def _insert_category(conn, user_id: int, name: str, type_: str) -> int:
    result = await conn.execute(
        text("INSERT INTO categories (user_id, name, type) VALUES (:u, :n, :t) RETURNING id"),
        {"u": user_id, "n": name, "t": type_},
    )
    return result.scalar_one()


async def test_duplicate_category_lower_name_rejected_by_index(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        async with conn.begin():
            uid = await _insert_user(conn, "dup@example.com")
            await _insert_category(conn, uid, "Groceries", "expense")
        with pytest.raises(DBAPIError) as excinfo:
            async with conn.begin():
                await _insert_category(conn, uid, "gROCERIES", "expense")
        assert "uq_categories_user_lower_name" in str(excinfo.value)


async def test_duplicate_budget_unique_rejected(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        async with conn.begin():
            uid = await _insert_user(conn, "bud@example.com")
            cid = await _insert_category(conn, uid, "Rent", "expense")
            await conn.execute(
                text("INSERT INTO budgets (user_id, category_id, year, month, amount) VALUES (:u, :c, 2026, 3, 100)"),
                {"u": uid, "c": cid},
            )
        with pytest.raises(DBAPIError) as excinfo:
            async with conn.begin():
                await conn.execute(
                    text("INSERT INTO budgets (user_id, category_id, year, month, amount) VALUES (:u, :c, 2026, 3, 200)"),
                    {"u": uid, "c": cid},
                )
        assert "uq_budgets_user_cat_period" in str(excinfo.value)


async def test_transaction_amount_check_rejects_nonpositive(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        async with conn.begin():
            uid = await _insert_user(conn, "chk@example.com")
        with pytest.raises(DBAPIError) as excinfo:
            async with conn.begin():
                await conn.execute(
                    text(
                        "INSERT INTO transactions (user_id, amount, type, description, date) "
                        "VALUES (:u, -1, 'expense', 'x', '2026-01-01')"
                    ),
                    {"u": uid},
                )
        assert "ck_transactions_amount_positive" in str(excinfo.value)


async def test_category_delete_blocked_by_transactions_restrict(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        async with conn.begin():
            uid = await _insert_user(conn, "rstr@example.com")
            cid = await _insert_category(conn, uid, "Kept", "expense")
            await conn.execute(
                text(
                    "INSERT INTO transactions (user_id, category_id, amount, type, description, date) "
                    "VALUES (:u, :c, 10, 'expense', 'x', '2026-01-01')"
                ),
                {"u": uid, "c": cid},
            )
        with pytest.raises(DBAPIError):
            async with conn.begin():
                await conn.execute(text("DELETE FROM categories WHERE id = :c"), {"c": cid})
