import pytest
from httpx import AsyncClient

from app.core.security import create_access_token
from tests.conftest import register_and_login


async def test_register_returns_201_and_user_payload(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register", json={"email": "Alice@Example.com", "password": "supersecret123"}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == "alice@example.com"  # stored lowercase
    assert body["is_active"] is True
    assert "password" not in body and "password_hash" not in body


async def test_register_short_password_422(client: AsyncClient) -> None:
    resp = await client.post("/api/v1/auth/register", json={"email": "a@b.com", "password": "short"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


async def test_register_bad_email_422(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register", json={"email": "not-an-email", "password": "supersecret123"}
    )
    assert resp.status_code == 422


async def test_register_duplicate_email_409(client: AsyncClient) -> None:
    payload = {"email": "dup@example.com", "password": "supersecret123"}
    first = await client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201
    second = await client.post("/api/v1/auth/register", json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "email_taken"


async def test_login_success_returns_token(client: AsyncClient) -> None:
    await register_and_login(client, email="login@example.com")
    resp = await client.post(
        "/api/v1/auth/login", data={"username": "login@example.com", "password": "supersecret123"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]


@pytest.mark.parametrize(
    "email,password",
    [
        ("wrongpw@example.com", "wrongpassword"),
        ("ghost@example.com", "supersecret123"),
    ],
)
async def test_login_failures_share_message(client: AsyncClient, email: str, password: str) -> None:
    if email == "wrongpw@example.com":
        reg = await client.post(
            "/api/v1/auth/register", json={"email": email, "password": "supersecret123"}
        )
        assert reg.status_code == 201
    resp = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    assert resp.status_code == 401
    assert resp.json()["error"]["message"] == "Invalid email or password"


async def test_me_with_token(client: AsyncClient) -> None:
    headers = await register_and_login(client, email="me@example.com")
    resp = await client.get("/api/v1/auth/me", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == "me@example.com"


async def test_me_without_token_401(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_me_with_garbage_token_401(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert resp.status_code == 401


async def test_me_with_expired_token_401(client: AsyncClient) -> None:
    headers = await register_and_login(client, email="expired@example.com")
    # Create a token that was already expired an hour ago.
    token = create_access_token("1", expires_minutes=-60)
    resp = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
