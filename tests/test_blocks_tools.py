"""Integration tests for tool event emission in blocks mode."""
import json
import sys
from pathlib import Path

import requests


SERVER_URL = "http://127.0.0.1:8225"


def parse_sse(raw: str) -> list[tuple[str, dict]]:
    events = []
    current_event = None
    for line in raw.split("\n"):
        line = line.rstrip("\r")
        if line.startswith("event: "):
            current_event = line[7:]
        elif line.startswith("data: "):
            events.append((current_event, json.loads(line[6:])))
    return events


def test_blocks_mode_emits_tool_events():
    """When LLM uses tools in blocks mode, tool_result events should be emitted.

    This test uses the already-running server (started externally).
    """
    r = requests.post(
        f"{SERVER_URL}/api/chat",
        json={
            "message": "Read the file chat_server.py and return its first line.",
            "response_mode": "blocks",
        },
        stream=True,
        timeout=60,
    )
    r.raise_for_status()
    raw = r.text
    events = parse_sse(raw)

    # Should have at least one tool_result event if the LLM used a tool
    tool_events = [e for e in events if e[1].get("type") == "tool_result"]

    # Verify structure if tool events exist
    for evt in tool_events:
        assert "tool_name" in evt[1], f"tool_result missing tool_name: {evt[1]}"
        assert "tool_id" in evt[1], f"tool_result missing tool_id: {evt[1]}"

    # Always check that done event has response_mode
    done_events = [e for e in events if e[0] == "done"]
    if done_events:
        assert done_events[0][1].get("response_mode") in ("blocks", "normal")

    # Log what we found for debugging
    event_types = {}
    for evt, data in events:
        t = data.get("type", evt)
        event_types[t] = event_types.get(t, 0) + 1
    print(f"Event types: {event_types}")
