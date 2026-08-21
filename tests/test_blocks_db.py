"""Tests for the enriched_blocks DB layer."""
import asyncio
import sys
import aiosqlite
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas import ContentBlock, EnrichedContentBlock
from chat_server import get_db, _persist_enriched_blocks, _get_enriched_blocks


@pytest.fixture
def db_path(tmp_path):
    """Use a temp DB file so tests don't pollute production DB."""
    db_file = tmp_path / "test.db"
    return str(db_file)


@pytest.mark.asyncio
async def test_persist_and_retrieve_single_message(db_path):
    """Single message's blocks should be retrievable."""
    # Override the global _db_conn with a temp DB
    import chat_server
    conn = await aiosqlite.connect(db_path)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS enriched_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id TEXT NOT NULL,
            message_index INTEGER NOT NULL,
            blocks_json TEXT NOT NULL
        )
    """)
    await conn.commit()
    chat_server._db_conn = conn

    blocks = [
        EnrichedContentBlock(
            uuid="test-uuid-1",
            sequence_id=1,
            markdown="# Test",
            spoken_explanation="A test block",
        )
    ]
    await _persist_enriched_blocks("test-thread-1", blocks, message_index=0)

    result = await _get_enriched_blocks("test-thread-1")
    assert result is not None
    assert len(result) == 1
    assert result[0].markdown == "# Test"
    assert result[0].uuid == "test-uuid-1"

    await conn.close()
    chat_server._db_conn = None


@pytest.mark.asyncio
async def test_multiple_messages_dont_overwrite(db_path):
    """A second message should NOT overwrite the first message's blocks."""
    import chat_server
    conn = await aiosqlite.connect(db_path)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS enriched_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id TEXT NOT NULL,
            message_index INTEGER NOT NULL,
            blocks_json TEXT NOT NULL
        )
    """)
    await conn.commit()
    chat_server._db_conn = conn

    blocks_0 = [
        EnrichedContentBlock(uuid="uuid-0", sequence_id=1, markdown="message one", spoken_explanation="explain one")
    ]
    blocks_1 = [
        EnrichedContentBlock(uuid="uuid-1", sequence_id=1, markdown="message two", spoken_explanation="explain two")
    ]

    await _persist_enriched_blocks("multi-thread", blocks_0, message_index=0)
    await _persist_enriched_blocks("multi-thread", blocks_1, message_index=1)

    # _get_enriched_blocks returns the latest (message_index=1)
    result = await _get_enriched_blocks("multi-thread")
    assert result is not None
    assert result[0].markdown == "message two"

    # But message_index=0 is still in DB
    async with conn.cursor() as cursor:
        await cursor.execute(
            "SELECT blocks_json FROM enriched_blocks WHERE thread_id = ? ORDER BY message_index",
            ("multi-thread",),
        )
        rows = await cursor.fetchall()

    assert len(rows) == 2
    import json
    blocks_0_data = json.loads(rows[0][0])
    assert blocks_0_data[0]["markdown"] == "message one"

    await conn.close()
    chat_server._db_conn = None


@pytest.mark.asyncio
async def test_get_enriched_blocks_missing_thread_returns_none(db_path):
    """Non-existent thread should return None, not raise."""
    import chat_server
    conn = await aiosqlite.connect(db_path)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS enriched_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id TEXT NOT NULL,
            message_index INTEGER NOT NULL,
            blocks_json TEXT NOT NULL
        )
    """)
    await conn.commit()
    chat_server._db_conn = conn

    result = await _get_enriched_blocks("nonexistent-thread")
    assert result is None

    await conn.close()
    chat_server._db_conn = None
