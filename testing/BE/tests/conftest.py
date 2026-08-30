import os

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base, get_db
from app.main import create_app
import app.models  # noqa: F401  (register tables on Base.metadata)

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance_test"
)


@pytest_asyncio.fixture
async def engine():
    test_engine = create_async_engine(TEST_DATABASE_URL)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield test_engine
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def app(engine, session_factory):
    application = create_app()

    async def override_get_db():
        session = session_factory()
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise
        finally:
            await session.close()

    application.dependency_overrides[get_db] = override_get_db
    yield application


@pytest_asyncio.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as async_client:
        yield async_client


async def register_and_login(
    client: AsyncClient,
    email: str = "user@example.com",
    password: str = "supersecret123",
) -> dict[str, str]:
    """Register a user, log in, and return auth headers."""
    reg = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert reg.status_code == 201, reg.text
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}
