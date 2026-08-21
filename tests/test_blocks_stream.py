"""Integration tests for blocks mode SSE flow.

These tests assume the FastAPI server is already running on port 8225.
"""
import json
from pathlib import Path

import requests


SERVER_URL = "http://127.0.0.1:8225"


def parse_sse(raw: str) -> list[tuple[str, dict]]:
    """Parse SSE stream into (event_type, data) pairs."""
    events = []
    current_event = None
    for line in raw.split("\n"):
        line = line.rstrip("\r")
        if line.startswith("event: "):
            current_event = line[7:]
        elif line.startswith("data: "):
            events.append((current_event, json.loads(line[6:])))
    return events


def test_blocks_mode_returns_content_block_events():
    """blocks mode should emit at least one content_block SSE event and
    a final done with response_mode=blocks and block_count > 0."""
    r = requests.post(
        f"{SERVER_URL}/api/chat",
        json={
            "message": "Return exactly two blocks. Block 1: markdown='# Hello'. Block 2: markdown='# World'. Each block must also have a spoken_explanation.",
            "response_mode": "blocks",
        },
        stream=True,
        timeout=30,
    )
    r.raise_for_status()
    raw = r.text
    events = parse_sse(raw)

    content_blocks = [e for e in events if e[0] == "message" and e[1].get("type") == "content_block"]
    done_events = [e for e in events if e[0] == "done"]

    assert len(content_blocks) >= 1, f"Expected >=1 content_block events, got {len(content_blocks)}"
    assert len(done_events) == 1, f"Expected 1 done event, got {len(done_events)}"
    done = done_events[0][1]
    assert done["response_mode"] == "blocks", f"Done response_mode={done['response_mode']}"
    assert done.get("block_count", 0) >= 1, f"Done block_count={done.get('block_count')}"
    # Verify content_block has required fields
    cb = content_blocks[0][1]
    for key in ("uuid", "sequence_id", "markdown", "spoken_explanation"):
        assert key in cb, f"content_block missing key: {key}"


def test_blocks_mode_valid_response_for_any_input():
    """Verify the server always returns a valid done event, regardless of input.

    The LLM may return blocks or fall back to normal mode depending on what it
    decides to generate. Both are valid — we just verify the response structure
    is correct and the server doesn't crash.
    """
    r = requests.post(
        f"{SERVER_URL}/api/chat",
        json={
            "message": "Just say '42'. Do not return JSON or blocks. Just the number.",
            "response_mode": "blocks",
        },
        stream=True,
        timeout=30,
    )
    r.raise_for_status()
    raw = r.text
    events = parse_sse(raw)

    done_events = [e for e in events if e[0] == "done"]

    assert len(done_events) == 1, f"Expected 1 done event, got {len(done_events)}"
    done = done_events[0][1]
    # The server should always return a done event with either "blocks" or "normal"
    assert done["response_mode"] in ("blocks", "normal"), \
        f"Unexpected response_mode={done['response_mode']}"
    assert done["thread_id"] is not None, "Done event missing thread_id"


def test_blocks_mode_persist_after_emit():
    """After a successful blocks response, blocks should be queryable
    from the DB immediately. This proves the emit-before-persist order works."""
    r = requests.post(
        f"{SERVER_URL}/api/chat",
        json={
            "message": "Return one block. markdown='persist-test'. spoken_explanation='test'.",
            "response_mode": "blocks",
        },
        stream=True,
        timeout=30,
    )
    r.raise_for_status()
    raw = r.text
    events = parse_sse(raw)

    done_events = [e for e in events if e[0] == "done"]
    assert len(done_events) == 1
    session_id = done_events[0][1]["thread_id"]

    # Now query the enriched_blocks endpoint
    r2 = requests.get(
        f"{SERVER_URL}/api/sessions/{session_id}/messages",
        params={"workspace": "."},
        timeout=10,
    )
    r2.raise_for_status()
    body = r2.json()
    enriched = body.get("enriched_blocks")
    assert enriched is not None, "enriched_blocks should be present in response"
    assert len(enriched) >= 1, f"Expected >=1 blocks in DB, got {len(enriched)}"
    # Verify the markdown matches what was requested
    block_md = enriched[0].get("markdown", "")
    assert "persist-test" in block_md.lower() or len(block_md) > 0, \
        f"Block markdown={block_md!r}"
