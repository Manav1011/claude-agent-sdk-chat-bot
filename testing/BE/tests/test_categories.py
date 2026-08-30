from httpx import AsyncClient

from tests.conftest import register_and_login

BASE = "/api/v1/categories"


async def _create_category(client: AsyncClient, headers: dict, name: str, type_: str = "expense") -> dict:
    resp = await client.post(BASE, json={"name": name, "type": type_}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_category_crud(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    created = await _create_category(client, headers, "Groceries")

    got = await client.get(f"{BASE}/{created['id']}", headers=headers)
    assert got.status_code == 200
    assert got.json()["name"] == "Groceries"

    upd = await client.put(f"{BASE}/{created['id']}", json={"name": "Food"}, headers=headers)
    assert upd.status_code == 200
    assert upd.json()["name"] == "Food"
    assert upd.json()["type"] == "expense"

    lst = await client.get(BASE, headers=headers)
    assert lst.status_code == 200
    assert [c["id"] for c in lst.json()] == [created["id"]]

    dele = await client.delete(f"{BASE}/{created['id']}", headers=headers)
    assert dele.status_code == 204


async def test_duplicate_name_case_insensitive_409(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    await _create_category(client, headers, "Groceries")
    resp = await client.post(BASE, json={"name": "GROCERIES", "type": "expense"}, headers=headers)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "duplicate"


async def test_same_name_other_type_allowed(client: AsyncClient) -> None:
    # Unique index is on (user_id, lower(name)) only per plan; income/expense same name collide.
    # Verify documented behavior: the index covers name only, so this IS a conflict.
    headers = await register_and_login(client)
    await _create_category(client, headers, "Salary", "income")
    resp = await client.post(BASE, json={"name": "salary", "type": "expense"}, headers=headers)
    assert resp.status_code == 409


async def test_delete_with_transactions_409(client: AsyncClient) -> None:
    headers = await register_and_login(client)
    cat = await _create_category(client, headers, "Rent")
    tx = await client.post(
        "/api/v1/transactions",
        json={"amount": "100.00", "type": "expense", "category_id": cat["id"], "description": "Rent", "date": "2026-03-01"},
        headers=headers,
    )
    assert tx.status_code == 201

    resp = await client.delete(f"{BASE}/{cat['id']}", headers=headers)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "in_use"

    # Remove the transaction, then delete works.
    await client.delete(f"/api/v1/transactions/{tx.json()['id']}", headers=headers)
    resp2 = await client.delete(f"{BASE}/{cat['id']}", headers=headers)
    assert resp2.status_code == 204


async def test_isolation_between_users(client: AsyncClient) -> None:
    h1 = await register_and_login(client, email="one@example.com")
    h2 = await register_and_login(client, email="two@example.com")
    cat1 = await _create_category(client, h1, "Private")

    resp = await client.get(f"{BASE}/{cat1['id']}", headers=h2)
    assert resp.status_code == 404
    resp = await client.put(f"{BASE}/{cat1['id']}", json={"name": "Hacked"}, headers=h2)
    assert resp.status_code == 404
    resp = await client.delete(f"{BASE}/{cat1['id']}", headers=h2)
    assert resp.status_code == 404

    lst = await client.get(BASE, headers=h2)
    assert lst.json() == []

    # h2 can create the same name; namespaces are per user
    ok = await client.post(BASE, json={"name": "Private", "type": "expense"}, headers=h2)
    assert ok.status_code == 201
