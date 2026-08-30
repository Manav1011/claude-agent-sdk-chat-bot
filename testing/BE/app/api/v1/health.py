from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import error_payload

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/liveness", summary="Liveness probe", response_model=dict)
async def liveness() -> dict:
    return {"status": "ok"}


@router.get("/readiness", summary="Readiness probe (checks database)", response_model=dict)
async def readiness(session: AsyncSession = Depends(get_db)) -> dict:
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        await session.rollback()
        return JSONResponse(
            status_code=503,
            content=error_payload("db_unavailable", "Database unavailable"),
        )
    return {"status": "ok"}
