"""Concurrency safety tests for DB and client caching.

Note: DB layer has been removed. These tests now verify:
1. get_db no longer exists (DB is removed)
2. _db_lock no longer exists (DB is removed)
3. _cache_lock still exists for SDK client caching
4. _WORKSPACE_CLIENTS dict exists
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import chat_server


def test_get_db_removed():
    """get_db should no longer exist since the DB layer was removed."""
    assert not hasattr(chat_server, "get_db"), "get_db should be removed"


def test_db_lock_removed():
    """_db_lock should no longer exist since the DB layer was removed."""
    assert not hasattr(chat_server, "_db_lock"), "_db_lock should be removed"


def test_cache_lock_still_exists():
    """_cache_lock should still exist for SDK client caching."""
    assert hasattr(chat_server, "_cache_lock")
    assert isinstance(chat_server._cache_lock, asyncio.Lock)


def test_workspace_clients_still_exists():
    """_WORKSPACE_CLIENTS should still exist for SDK client caching."""
    assert hasattr(chat_server, "_WORKSPACE_CLIENTS")
    assert isinstance(chat_server._WORKSPACE_CLIENTS, dict)
