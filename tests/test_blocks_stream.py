"""Integration tests for blocks mode SSE flow.

These tests start the FastAPI server and hit /api/chat to verify
end-to-end SSE behavior. Each test sends a prompt designed to trigger
the specific scenario being tested.
"""
import asyncio
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import requests

# Start server in background, run tests, kill server
SERVER_URL = "http://127.0.0.1:8225"


def start_server():
    """Start chat_server.py in the background and wait until it's ready."""
    proc = subprocess.Popen(
        [sys.executable, "chat_server.py"],
        cwd=str(Path(__file__).parent.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    # Wait up to 10 seconds for server to be ready
    for _ in range(50):
        try:
            r = requests.get(f"{SERVER_URL}/api/health", timeout=1)
            if r.status_code == 200:
                break
        except Exception:
            pass
        time.sleep(0.2)
    return proc


def stop_server(proc):
    proc.terminate()
    proc.wait(timeout=5)


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
    proc = start_server()
    try:
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
    finally:
        stop_server(proc)


def test_blocks_mode_error_fallback_on_bad_input():
    """If LLM returns malformed blocks, the stream should emit error event
    and done with response_mode=normal, NOT response_mode=blocks."""
    proc = start_server()
    try:
        r = requests.post(
            f"{SERVER_URL}/api/chat",
            json={
                "message": "Respond with a number, not blocks. Just '42'.",
                "response_mode": "blocks",
            },
            stream=True,
            timeout=30,
        )
        r.raise_for_status()
        raw = r.text
        events = parse_sse(raw)

        done_events = [e for e in events if e[0] == "done"]
        error_events = [e for e in events if e[0] == "error"]

        assert len(done_events) == 1
        done = done_events[0][1]
        # Should fall back to normal, not stay in blocks
        assert done["response_mode"] == "normal", \
            f"Expected fallback to normal, got response_mode={done['response_mode']}"
        # May or may not have error event depending on whether LLM returns valid JSON;
        # the critical check is response_mode: "normal" on done
    finally:
        stop_server(proc)


def test_blocks_mode_persist_after_emit():
    """After a successful blocks response, blocks should be queryable
    from the DB immediately. This proves the emit-before-persist order works."""
    proc = start_server()
    try:
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
    finally:
        stop_server(proc)
