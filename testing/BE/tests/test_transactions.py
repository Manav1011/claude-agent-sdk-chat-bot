from decimal import Decimal

import pytest
from httpx import AsyncClient

from tests.conftest import register_and_login

BASE = "/api/v1/transactions"


async def _cat(client: AsyncClient, headers: dict, name: str, type_: str = "expense") -> int:
    resp = await client.post("/api/v1/categories", json={"name": name, "type": type_}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _tx(client: AsyncClient, headers: dict, payload: dict) -> dict:
    resp = await client.post(BASE, json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_transaction_201(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    cat_id = await _cat(client, headers, "Groceries")
    body = await _tx(
        client,
        headers,
        {"amount": "42.50", "type": "expense", "category_id": cat_id, "description": "Food", "date": "2026-03-14"},
    )
    assert Decimal(body["amount"]) == Decimal("42.50")
    assert body["category"]["id"] == cat_id
    assert body["category"]["name"] == "Groceries"


@pytest.mark.parametrize("bad_amount", ["-5.00", "0", "0.00", "10.123", "999999999999.00", "abc"])
async def test_bad_amounts_422(client: AsyncClient, bad_amount) -> None:
    headers = await register_and_login(client)
    resp = await client.post(
        BASE,
        json={"amount": bad_amount, "type": "expense", "description": "x", "date": "2026-03-14"},
        headers=headers,
    )
    assert resp.status_code == 422


async def test_create_without_category_ok(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    body = await _tx(client, headers, {"amount": "5.00", "type": "expense", "description": "Misc", "date": "2026-03-01"})
    assert body["category_id"] is None
    assert body["category"] is None


async def test_income_tx_with_expense_category_422(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    cat_id = await _cat(client, headers, "Groceries", "expense")
    resp = await client.post(
        BASE,
        json={"amount": "5.00", "type": "income", "category_id": cat_id, "description": "x", "date": "2026-03-01"},
        headers=headers,
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "category_mismatch"


async def test_foreign_category_404(client: AsyncClient) -> None:
    headers = await register_and_login(client, email="a@example.com")
    other_headers = await register_and_login(client, email="b@example.com")
    cat_id = await _cat(client, other_headers, "Theirs")
    resp = await client.post(
        BASE,
        json={"amount": "5.00", "type": "expense", "category_id": cat_id, "description": "x", "date": "2026-03-01"},
        headers=headers,
    )
    assert resp.status_code == 404


async def test_update_type_mismatch_with_existing_category_422(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    cat_id = await _cat(client, headers, "Groceries", "expense")
    body = await _tx(
        client, headers, {"amount": "5.00", "type": "expense", "category_id": cat_id, "description": "x", "date": "2026-03-01"}
    )
    resp = await client.put(f"{BASE}/{body['id']}", json={"type": "income"}, headers=headers)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "category_mismatch"


async def test_list_filters_sort_pagination(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    food = await _cat(client, headers, "Food")
    fun = await _cat(client, headers, "Fun")

    await _tx(client, headers, {"amount": "10.00", "type": "expense", "category_id": food, "description": "apples", "date": "2026-01-05"})
    await _tx(client, headers, {"amount": "20.00", "type": "expense", "category_id": food, "description": "bananas", "date": "2026-02-05"})
    await _tx(client, headers, {"amount": "30.00", "type": "expense", "category_id": fun, "description": "cinema night", "date": "2026-03-05"})
    await _tx(client, headers, {"amount": "500.00", "type": "income", "description": "salary", "date": "2026-03-01"})

    # type filter
    resp = await client.get(BASE, params={"type": "expense"}, headers=headers)
    assert resp.json()["total"] == 3
    # category filter
    resp = await client.get(BASE, params={"category_id": food}, headers=headers)
    assert resp.json()["total"] == 2
    # date range
    resp = await client.get(BASE, params={"date_from": "2026-02-01", "date_to": "2026-03-31"}, headers=headers)
    assert {t["description"] for t in resp.json()["items"]} == {"bananas", "cinema night", "salary"}
    # q search
    resp = await client.get(BASE, params={"q": "banana"}, headers=headers)
    assert resp.json()["total"] == 1
    # sort by amount asc
    resp = await client.get(BASE, params={"sort": "amount", "order": "asc"}, headers=headers)
    amounts = [Decimal(t["amount"]) for t in resp.json()["items"]]
    assert amounts == sorted(amounts)

    # pagination
    resp = await client.get(BASE, params={"page": 1, "page_size": 2}, headers=headers)
    page = resp.json()
    assert page["total"] == 4 and len(page["items"]) == 2 and page["page"] == 1
    resp = await client.get(BASE, params={"page": 2, "page_size": 2}, headers=headers)
    assert len(resp.json()["items"]) == 2
    resp = await client.get(BASE, params={"page": 5, "page_size": 20}, headers=headers)
    assert resp.json()["items"] == [] and resp.json()["total"] == 4


async def test_get_update_delete_own_and_foreign_404(client: AsyncClient) -> None:
    h1 = await register_and_login(client, email="owner@example.com")
    h2 = await register_and_login(client, email="thief@example.com")
    body = await _tx(client, h1, {"amount": "7.00", "type": "expense", "description": "mine", "date": "2026-03-03"})

    assert (await client.get(f"{BASE}/{body['id']}", headers=h1)).status_code == 200
    assert (await client.put(f"{BASE}/{body['id']}", json={"amount": "8.00"}, headers=h1)).status_code == 200

    assert (await client.get(f"{BASE}/{body['id']}", headers=h2)).status_code == 404
    assert (await client.put(f"{BASE}/{body['id']}", json={"amount": "9.00"}, headers=h2)).status_code == 404
    assert (await client.delete(f"{BASE}/{body['id']}", headers=h2)).status_code == 404

    assert (await client.delete(f"{BASE}/{body['id']}", headers=h1)).status_code == 204
    assert (await client.get(f"{BASE}/{body['id']}", headers=h1)).status_code == 404
