from decimal import Decimal

from httpx import AsyncClient

from tests.conftest import register_and_login

BASE = "/api/v1/budgets"


async def _cat(client: AsyncClient, headers: dict, name: str, type_: str = "expense") -> int:
    resp = await client.post("/api/v1/categories", json={"name": name, "type": type_}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_budget_create_list_update_delete(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    cat_id = await _cat(client, headers, "Groceries")

    created = await client.post(BASE, json={"category_id": cat_id, "year": 2026, "month": 3, "amount": "400.00"}, headers=headers)
    assert created.status_code == 201
    body = created.json()
    assert Decimal(body["amount"]) == Decimal("400.00")
    assert body["category_name"] == "Groceries"

    lst = await client.get(BASE, params={"year": 2026, "month": 3}, headers=headers)
    assert lst.status_code == 200
    assert [b["id"] for b in lst.json()] == [body["id"]]
    assert (await client.get(BASE, params={"year": 2026, "month": 4}, headers=headers)).json() == []

    upd = await client.put(f"{BASE}/{body['id']}", json={"amount": "450.00"}, headers=headers)
    assert upd.status_code == 200
    assert Decimal(upd.json()["amount"]) == Decimal("450.00")

    assert (await client.delete(f"{BASE}/{body['id']}", headers=headers)).status_code == 204
    assert (await client.get(BASE, params={"year": 2026, "month": 3}, headers=headers)).json() == []


async def test_duplicate_budget_409(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    cat_id = await _cat(client, headers, "Groceries")
    payload = {"category_id": cat_id, "year": 2026, "month": 3, "amount": "400.00"}
    assert (await client.post(BASE, json=payload, headers=headers)).status_code == 201
    dup = await client.post(BASE, json=payload, headers=headers)
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "duplicate"
    # Same category, different month is fine.
    other = dict(payload, month=4)
    assert (await client.post(BASE, json=other, headers=headers)).status_code == 201


async def test_budget_on_income_category_422(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    cat_id = await _cat(client, headers, "Salary", "income")
    resp = await client.post(BASE, json={"category_id": cat_id, "year": 2026, "month": 3, "amount": "100.00"}, headers=headers)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "not_an_expense_category"


async def test_budget_month_out_of_range_422(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    cat_id = await _cat(client, headers, "Groceries")
    resp = await client.post(BASE, json={"category_id": cat_id, "year": 2026, "month": 13, "amount": "100.00"}, headers=headers)
    assert resp.status_code == 422


async def test_budget_foreign_category_404(client: AsyncClient) -> None:
    h1 = await register_and_login(client, email="one@example.com")
    h2 = await register_and_login(client, email="two@example.com")
    cat_id = await _cat(client, h2, "Theirs")
    resp = await client.post(BASE, json={"category_id": cat_id, "year": 2026, "month": 3, "amount": "100.00"}, headers=h1)
    assert resp.status_code == 404


async def test_budget_isolation(client: AsyncClient) -> None:
    h1 = await register_and_login(client, email="one@example.com")
    h2 = await register_and_login(client, email="two@example.com")
    cat1 = await _cat(client, h1, "Groceries")
    created = await client.post(BASE, json={"category_id": cat1, "year": 2026, "month": 3, "amount": "100.00"}, headers=h1)
    budget_id = created.json()["id"]

    assert (await client.get(BASE, params={"year": 2026, "month": 3}, headers=h2)).json() == []
    assert (await client.put(f"{BASE}/{budget_id}", json={"amount": "1.00"}, headers=h2)).status_code == 404
    assert (await client.delete(f"{BASE}/{budget_id}", headers=h2)).status_code == 404
