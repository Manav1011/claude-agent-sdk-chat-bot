from httpx import AsyncClient


async def test_liveness(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/health/liveness")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_readiness_with_db_up(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/health/readiness")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
