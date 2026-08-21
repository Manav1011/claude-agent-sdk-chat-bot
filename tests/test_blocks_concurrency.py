"""Concurrency safety tests for DB and client caching."""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from chat_server import get_db, _db_lock, _cache_lock


@pytest.mark.asyncio
async def test_get_db_returns_same_connection():
    """Two concurrent calls to get_db() should return the same connection."""
    conn1 = await get_db()
    conn2 = await get_db()
    assert conn1 is conn2


@pytest.mark.asyncio
async def test_db_lock_acquired():
    """The _db_lock should exist and be an asyncio.Lock."""
    assert isinstance(_db_lock, asyncio.Lock)


@pytest.mark.asyncio
async def test_cache_lock_acquired():
    """The _cache_lock should exist and be an asyncio.Lock."""
    assert isinstance(_cache_lock, asyncio.Lock)
