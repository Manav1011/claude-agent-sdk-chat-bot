from datetime import date
from decimal import Decimal

from httpx import AsyncClient

from tests.conftest import register_and_login


def _month_start(k_ago: int) -> date:
    """First day of the month that is k months before the current month."""
    today = date.today()
    index = today.year * 12 + (today.month - 1) - k_ago
    return date(index // 12, index % 12 + 1, 1)


async def _cat(client: AsyncClient, headers: dict, name: str, type_: str = "expense") -> int:
    resp = await client.post("/api/v1/categories", json={"name": name, "type": type_}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _tx(client: AsyncClient, headers: dict, payload: dict) -> None:
    resp = await client.post("/api/v1/transactions", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text


async def _seed(client: AsyncClient, headers: dict) -> dict:
    food = await _cat(client, headers, "Food")
    rent = await _cat(client, headers, "Rent")
    await _tx(client, headers, {"amount": "1000.00", "type": "income", "description": "salary", "date": "2026-03-01"})
    await _tx(client, headers, {"amount": "200.00", "type": "expense", "category_id": food, "description": "groceries", "date": "2026-03-05"})
    await _tx(client, headers, {"amount": "50.00", "type": "expense", "category_id": food, "description": "snacks", "date": "2026-03-10"})
    await _tx(client, headers, {"amount": "300.00", "type": "expense", "category_id": rent, "description": "monthly rent", "date": "2026-03-15"})
    await _tx(client, headers, {"amount": "25.00", "type": "expense", "description": "uncategorized coffee", "date": "2026-03-20"})
    # Out-of-month transaction that must never leak into reports.
    await _tx(client, headers, {"amount": "999.00", "type": "expense", "description": "april only", "date": "2026-04-01"})
    return {"food": food, "rent": rent}


async def test_summary_positive_net(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    await _seed(client, headers)
    resp = await client.get("/api/v1/reports/summary", params={"year": 2026, "month": 3}, headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert Decimal(body["income_total"]) == Decimal("1000.00")
    assert Decimal(body["expense_total"]) == Decimal("575.00")
    assert Decimal(body["net"]) == Decimal("425.00")
    assert body["transaction_count"] == 5


async def test_summary_negative_net(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    await _tx(client, headers, {"amount": "100.00", "type": "income", "description": "allowance", "date": "2026-05-01"})
    await _tx(client, headers, {"amount": "500.00", "type": "expense", "description": "car repair", "date": "2026-05-02"})
    resp = await client.get("/api/v1/reports/summary", params={"year": 2026, "month": 5}, headers=headers)
    assert Decimal(resp.json()["net"]) == Decimal("-400.00")


async def test_summary_empty_month(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    resp = await client.get("/api/v1/reports/summary", params={"year": 2026, "month": 1}, headers=headers)
    body = resp.json()
    assert Decimal(body["income_total"]) == Decimal("0")
    assert Decimal(body["net"]) == Decimal("0")
    assert body["transaction_count"] == 0


async def test_breakdown_pct_and_uncategorized(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    await _seed(client, headers)
    resp = await client.get("/api/v1/reports/breakdown", params={"year": 2026, "month": 3}, headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    # Food 250, Rent 300, uncategorized 25 -> 3 rows, ordered desc.
    assert [i["category_name"] for i in items] == ["Rent", "Food", None]
    pct_sum = sum(Decimal(i["pct_of_total"]) for i in items)
    assert Decimal("99") <= pct_sum <= Decimal("101")
    assert Decimal(items[1]["total"]) == Decimal("250.00")
    uncategorized = items[-1]
    assert uncategorized["category_id"] is None
    assert Decimal(uncategorized["pct_of_total"]) == Decimal("4.35")  # 25/575*100


async def test_breakdown_income_type(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    await _seed(client, headers)
    resp = await client.get(
        "/api/v1/reports/breakdown", params={"year": 2026, "month": 3, "type": "income"}, headers=headers
    )
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["category_id"] is None
    assert Decimal(items[0]["pct_of_total"]) == Decimal("100.00")


async def test_budget_status_vs_actual_including_overspend(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    ids = await _seed(client, headers)
    # Food budget 300 (actual 250 -> under), rent budget 250 (actual 300 -> over).
    b1 = await client.post(
        "/api/v1/budgets", json={"category_id": ids["food"], "year": 2026, "month": 3, "amount": "300.00"}, headers=headers
    )
    b2 = await client.post(
        "/api/v1/budgets", json={"category_id": ids["rent"], "year": 2026, "month": 3, "amount": "250.00"}, headers=headers
    )
    assert b1.status_code == 201 and b2.status_code == 201

    resp = await client.get("/api/v1/reports/budget-status", params={"year": 2026, "month": 3}, headers=headers)
    assert resp.status_code == 200
    items = {i["budget_id"]: i for i in resp.json()}
    food = items[b1.json()["id"]]
    rent = items[b2.json()["id"]]

    assert food["month"] == "2026-03"
    assert Decimal(food["budgeted"]) == Decimal("300.00")
    assert Decimal(food["actual"]) == Decimal("250.00")
    assert Decimal(food["remaining"]) == Decimal("50.00")
    assert Decimal(food["percent_used"]) == Decimal("83.33")

    assert Decimal(rent["remaining"]) == Decimal("-50.00")  # overspend
    assert Decimal(rent["percent_used"]) == Decimal("120.00")


async def test_trends_zero_fill_order_and_window(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    today = date.today()
    await _tx(client, headers, {"amount": "1000.00", "type": "income", "description": "salary", "date": _month_start(0).isoformat()})
    await _tx(client, headers, {"amount": "400.00", "type": "expense", "description": "bills", "date": _month_start(0).replace(day=10).isoformat()})
    await _tx(client, headers, {"amount": "200.00", "type": "expense", "description": "old bill", "date": _month_start(2).isoformat()})
    # Outside a 6-month window: must not appear.
    await _tx(client, headers, {"amount": "999.00", "type": "expense", "description": "ancient", "date": _month_start(9).isoformat()})

    resp = await client.get("/api/v1/reports/trends", params={"months": 6}, headers=headers)
    assert resp.status_code == 200
    months = resp.json()["months"]
    assert len(months) == 6

    # Ascending, ending with the current month.
    keys = [(m["year"], m["month"]) for m in months]
    assert keys == sorted(keys)
    assert keys[-1] == (today.year, today.month)

    last = months[-1]
    assert Decimal(last["income_total"]) == Decimal("1000.00")
    assert Decimal(last["expense_total"]) == Decimal("400.00")
    assert Decimal(last["net"]) == Decimal("600.00")
    two_ago = months[-3]
    assert Decimal(two_ago["income_total"]) == Decimal("0.00")
    assert Decimal(two_ago["expense_total"]) == Decimal("200.00")
    assert Decimal(two_ago["net"]) == Decimal("-200.00")
    # Empty months are zero-filled, out-of-window tx excluded.
    assert Decimal(months[0]["expense_total"]) == Decimal("0.00")
    assert sum(Decimal(m["expense_total"]) for m in months) == Decimal("600.00")


async def test_trends_default_and_validation(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    resp = await client.get("/api/v1/reports/trends", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()["months"]) == 6
    assert all(Decimal(m["net"]) == Decimal("0") for m in resp.json()["months"])

    for bad in (0, 25):
        bad_resp = await client.get("/api/v1/reports/trends", params={"months": bad}, headers=headers)
        assert bad_resp.status_code == 422
