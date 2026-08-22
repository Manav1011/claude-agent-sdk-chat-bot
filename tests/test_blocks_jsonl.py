"""Tests for extracting blocks from SDK JSONL."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import chat_server
from chat_server import _read_sdk_history_and_blocks


def _sdk_jsonl_path(session_id: str) -> Path:
    """Return the real SDK JSONL path for a session_id."""
    project_key = chat_server._sdk_project_key(".")
    return Path.home() / ".claude" / "projects" / project_key / f"{session_id}.jsonl"


def test_parses_structured_output_from_jsonl():
    """Given a JSONL with a StructuredOutput tool_use entry, blocks should be extracted."""
    session_id = "test-blocks-jsonl-1"
    jsonl_path = _sdk_jsonl_path(session_id)

    try:
        with open(jsonl_path, "w") as f:
            f.write(json.dumps({"type": "queue-operation", "data": {}}) + "\n")
            f.write(json.dumps({"type": "user", "message": {"content": "Hello"}}) + "\n")
            f.write(json.dumps({
                "type": "assistant",
                "message": {"content": [
                    {"type": "tool_use", "name": "StructuredOutput", "id": "tool-1", "input": {
                        "blocks": [
                            {"markdown": "# Hello", "spoken_explanation": "A heading"},
                            {"markdown": "```python\nprint('hi')\n```", "spoken_explanation": "A code block"}
                        ]
                    }}
                ]}
            }) + "\n")

        messages, enriched_blocks = _read_sdk_history_and_blocks(".", session_id)

        assert len(messages) == 1
        assert messages[0]["type"] == "human"
        assert messages[0]["content"] == "Hello"

        assert len(enriched_blocks) == 2
        assert enriched_blocks[0]["markdown"] == "# Hello"
        assert enriched_blocks[0]["spoken_explanation"] == "A heading"
        assert "uuid" in enriched_blocks[0]
        assert enriched_blocks[0]["sequence_id"] == 1
        assert enriched_blocks[1]["sequence_id"] == 2
    finally:
        if jsonl_path.exists():
            jsonl_path.unlink()


def test_returns_empty_blocks_when_no_structured_output():
    """When JSONL has no StructuredOutput, enriched_blocks should be an empty list."""
    session_id = "test-blocks-jsonl-2"
    jsonl_path = _sdk_jsonl_path(session_id)

    try:
        with open(jsonl_path, "w") as f:
            f.write(json.dumps({"type": "user", "message": {"content": "Hi"}}) + "\n")
            f.write(json.dumps({
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": "Hello!"}]}
            }) + "\n")

        messages, enriched_blocks = _read_sdk_history_and_blocks(".", session_id)
        assert messages[0]["content"] == "Hi"
        assert enriched_blocks == []
    finally:
        if jsonl_path.exists():
            jsonl_path.unlink()


def test_malformed_structured_output_skipped_gracefully():
    """When a StructuredOutput entry has malformed blocks (missing spoken_explanation), it is skipped without crashing."""
    session_id = "test-blocks-jsonl-3"
    jsonl_path = _sdk_jsonl_path(session_id)

    try:
        with open(jsonl_path, "w") as f:
            f.write(json.dumps({
                "type": "assistant",
                "message": {"content": [
                    {"type": "tool_use", "name": "StructuredOutput", "id": "tool-1", "input": {
                        "blocks": [{"markdown": "# Valid"}]  # missing spoken_explanation — invalid per schema
                    }}
                ]}
            }) + "\n")

        _, enriched_blocks = _read_sdk_history_and_blocks(".", session_id)
        # Block should be skipped (schema requires spoken_explanation)
        assert enriched_blocks == []
    finally:
        if jsonl_path.exists():
            jsonl_path.unlink()