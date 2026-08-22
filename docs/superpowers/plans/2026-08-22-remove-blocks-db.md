# Remove Blocks Mode DB — Use SDK JSONL Instead

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove SQLite DB layer for blocks mode. Extract blocks from SDK's own JSONL files at read-time.

**Architecture:** The SDK stores structured output as `tool_use` blocks with `name: "StructuredOutput"` in the JSONL. Extend `_read_sdk_history` to also parse these blocks. No DB needed — SDK JSONL is the single source of truth.

**Tech Stack:** Python 3.11, FastAPI, SDK JSONL only.

---

## Global Constraints

- **Backward compat.** `MessagesResponse.enriched_blocks` field stays — same name, same shape.
- **No new dependencies.** Remove `aiosqlite` entirely.
- **Existing tests pass.** 10 tests should still pass after the change (3 core + 3 concurrency + 4 integration).
- **Concurrency tests must be updated.** `tests/test_blocks_concurrency.py` imports `_db_lock` which will be removed. Must update those tests to not depend on removed symbols.

---

## Task 1: Parse StructuredOutput from JSONL

**Files:**
- Modify: `chat_server.py:84-129` — extend `_read_sdk_history` to also extract blocks
- Create: `tests/test_blocks_jsonl.py`

**Interfaces:**
- Produces: `_read_sdk_history(workspace, session_id)` returns `tuple[list[dict], list[dict]]` — (messages, enriched_blocks)

**What to change:**

Add a new function that returns both messages and blocks:

```python
def _read_sdk_history_and_blocks(workspace: str, session_id: str) -> tuple[list[dict], list[dict]]:
    """Read conversation history and enriched blocks from SDK JSONL file.

    SDK stores structured output as:
      {type: "assistant", message: {content: [{type: "tool_use", name: "StructuredOutput", input: {blocks: [...]}}]}}
    """
    project_key = _sdk_project_key(workspace)
    jsonl_path = Path.home() / ".claude" / "projects" / project_key / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return [], []

    messages = []
    enriched_blocks = []

    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue

            entry_type = entry.get("type", "")

            if entry_type == "user":
                msg = entry.get("message", {})
                content = msg.get("content", "")
                if isinstance(content, str):
                    messages.append({"type": "human", "content": content})
                elif isinstance(content, list):
                    texts = [c.get("text", "") for c in content if c.get("type") == "text"]
                    if texts:
                        messages.append({"type": "human", "content": "".join(texts)})

            elif entry_type == "assistant":
                msg = entry.get("message", {})
                content = msg.get("content", [])
                if isinstance(content, list):
                    texts = []
                    for block in content:
                        if block.get("type") == "text":
                            texts.append(block.get("text", ""))
                        elif block.get("type") == "tool_use" and block.get("name") == "StructuredOutput":
                            input_data = block.get("input", {})
                            raw_blocks = input_data.get("blocks", [])
                            if raw_blocks:
                                try:
                                    from schemas import ContentBlock
                                    content_blocks = [ContentBlock(**b) for b in raw_blocks]
                                    enriched = _enrich_blocks(content_blocks)
                                    enriched_blocks.extend([b.model_dump() for b in enriched])
                                except Exception as e:
                                    print(f"[WARN] Failed to parse StructuredOutput blocks: {e}")
                    if texts:
                        messages.append({"type": "ai", "content": "".join(texts)})

    return messages, enriched_blocks
```

**Tests (in `tests/test_blocks_jsonl.py`):**

```python
"""Tests for extracting blocks from SDK JSONL."""
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from chat_server import _read_sdk_history_and_blocks


def test_parses_structured_output_from_jsonl():
    """Given a JSONL with a StructuredOutput tool_use entry, blocks should be extracted."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
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
        temp_path = f.name

    try:
        import chat_server
        original_key = chat_server._sdk_project_key
        project_dir = os.path.dirname(temp_path)
        chat_server._sdk_project_key = lambda ws: os.path.basename(project_dir)

        messages, enriched_blocks = _read_sdk_history_and_blocks(".", Path(temp_path).stem)

        assert len(messages) == 1
        assert messages[0]["type"] == "human"
        assert messages[0]["content"] == "Hello"

        assert len(enriched_blocks) == 2
        assert enriched_blocks[0]["markdown"] == "# Hello"
        assert enriched_blocks[0]["spoken_explanation"] == "A heading"
        assert "uuid" in enriched_blocks[0]
        assert enriched_blocks[0]["sequence_id"] == 1
        assert enriched_blocks[1]["sequence_id"] == 2

        chat_server._sdk_project_key = original_key
    finally:
        Path(temp_path).unlink()


def test_returns_empty_blocks_when_no_structured_output():
    """When JSONL has no StructuredOutput, enriched_blocks should be an empty list."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        f.write(json.dumps({"type": "user", "message": {"content": "Hi"}}) + "\n")
        f.write(json.dumps({
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "Hello!"}]}
        }) + "\n")
        temp_path = f.name

    try:
        import chat_server
        original_key = chat_server._sdk_project_key
        project_dir = os.path.dirname(temp_path)
        chat_server._sdk_project_key = lambda ws: os.path.basename(project_dir)

        messages, enriched_blocks = _read_sdk_history_and_blocks(".", Path(temp_path).stem)
        assert messages[0]["content"] == "Hi"
        assert enriched_blocks == []

        chat_server._sdk_project_key = original_key
    finally:
        Path(temp_path).unlink()


def test_malformed_structured_output_skipped_gracefully():
    """When a StructuredOutput entry has malformed blocks (missing spoken_explanation), it is skipped without crashing."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        f.write(json.dumps({
            "type": "assistant",
            "message": {"content": [
                {"type": "tool_use", "name": "StructuredOutput", "id": "tool-1", "input": {
                    "blocks": [{"markdown": "# Valid"}]  # missing spoken_explanation — invalid per schema
                }}
            ]}
        }) + "\n")
        temp_path = f.name

    try:
        import chat_server
        original_key = chat_server._sdk_project_key
        project_dir = os.path.dirname(temp_path)
        chat_server._sdk_project_key = lambda ws: os.path.basename(project_dir)

        messages, enriched_blocks = _read_sdk_history_and_blocks(".", Path(temp_path).stem)
        # Block should be skipped (schema requires spoken_explanation)
        assert enriched_blocks == []

        chat_server._sdk_project_key = original_key
    finally:
        Path(temp_path).unlink()
```

- [ ] **Step 1: Write the failing tests** — Create `tests/test_blocks_jsonl.py`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/web-h-063/Documents/explainer-bot
python -m pytest tests/test_blocks_jsonl.py -v 2>&1
```

Expected: FAIL — `_read_sdk_history_and_blocks` doesn't exist.

- [ ] **Step 3: Implement `_read_sdk_history_and_blocks`** — Add the function to `chat_server.py`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_blocks_jsonl.py -v 2>&1
```

Expected: PASS all three tests.

- [ ] **Step 5: Commit**

```bash
git add tests/test_blocks_jsonl.py chat_server.py
git commit -m "feat: extract enriched blocks from SDK JSONL instead of DB"
```

---

## Task 2: Update `get_session_messages` to use JSONL

**Files:**
- Modify: `chat_server.py:337-358`

**What to change:**

```python
@app.get("/api/sessions/{session_id}/messages", response_model=MessagesResponse)
async def get_session_messages(session_id: str, workspace: str | None = None):
    # Validate — SDK session_id must be UUID; if invalid, return empty history
    try:
        uuid.UUID(session_id)
    except ValueError:
        return MessagesResponse(session_id=session_id, messages=[], enriched_blocks=None)
    if workspace:
        ws = str(Path(workspace).expanduser().resolve())
    else:
        ws = _DEFAULT_WORKSPACE

    messages, enriched_blocks = _read_sdk_history_and_blocks(ws, session_id)

    return MessagesResponse(
        session_id=session_id,
        messages=messages,
        enriched_blocks=enriched_blocks if enriched_blocks else None,
    )
```

Key: replaces `messages = _read_sdk_history(...)` + `enriched_blocks = await _get_enriched_blocks(...)` with single `_read_sdk_history_and_blocks(...)`.

- [ ] **Step 1: Update `get_session_messages`** — Replace two-function call with `_read_sdk_history_and_blocks`.

- [ ] **Step 2: Start server and run integration test**

```bash
python chat_server.py &
sleep 3
python -m pytest tests/test_blocks_stream.py::test_blocks_mode_persist_after_emit -v 2>&1
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add chat_server.py
git commit -m "refactor: get_session_messages reads blocks from JSONL"
```

---

## Task 3: Remove DB persistence call from streaming

**Files:**
- Modify: `chat_server.py:598-603` — remove `_persist_enriched_blocks` call

**What to change:**

Remove this block entirely:
```python
# THEN persist to DB — failure here does not lose blocks from the user
try:
    await _persist_enriched_blocks(session_id, enriched)
except Exception as e:
    print(f"[WARN] Failed to persist blocks: {e}")
    # Non-fatal: blocks were already delivered to the client
```

Blocks are already emitted via SSE before this point (lines 589-596). SDK writes to JSONL automatically.

- [ ] **Step 1: Remove `_persist_enriched_blocks` call** — Delete lines 598-603.

- [ ] **Step 2: Run streaming tests**

```bash
python -m pytest tests/test_blocks_stream.py -v 2>&1
```

Expected: PASS all 3 tests.

- [ ] **Step 3: Commit**

```bash
git add chat_server.py
git commit -m "refactor: remove DB persistence from chat streaming"
```

---

## Task 4: Remove DB section, imports, and update delete endpoints

**Files:**
- Modify: `chat_server.py` — remove entire DB section, `aiosqlite` import, `_db_conn`, `_db_lock`, lifespan DB close

**What to change:**

1. **Remove import** (line ~18): `import aiosqlite`

2. **Remove global** (line ~72): `_db_conn = None`

3. **Remove lifespan DB close** (lines ~49-56):
```python
# REMOVE:
# global _db_conn, _WORKSPACE_CLIENTS
# _WORKSPACE_CLIENTS.clear()
# if _db_conn:
#     await _db_conn.close()
#     _db_conn = None
```
Keep just `_WORKSPACE_CLIENTS.clear()`.

4. **Remove DB section** (lines ~147-219): delete `get_db()`, `_persist_enriched_blocks()`, `_get_enriched_blocks()`, `_db_lock`

5. **Update `delete_session`** (lines ~361-371): remove DB `DELETE FROM enriched_blocks` call. Endpoint becomes a no-op since SDK JSONL deletion is not supported.

```python
@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete session data.

    Note: SDK JSONL deletion is not supported. This endpoint is a no-op for SDK data.
    """
    return {"status": "deleted", "session_id": session_id}
```

6. **Update `delete_all_sessions`** (lines ~374-383): same — remove DB `DELETE FROM enriched_blocks`, become no-op.

- [ ] **Step 1: Remove all DB code** — Remove import, global, lifespan DB close, entire DB section.

- [ ] **Step 2: Update delete endpoints** — Remove DB operations from `delete_session` and `delete_all_sessions`.

- [ ] **Step 3: Update `tests/test_blocks_concurrency.py`** — The `_db_lock` symbol is removed. Update tests that reference it. The `test_get_db_returns_same_connection` test should be deleted or replaced with a test that verifies `get_db` no longer exists. Replace the three concurrency tests with:

```python
"""Concurrency safety tests for DB and client caching.

Note: DB layer has been removed. These tests now verify:
1. get_db no longer exists (DB is removed)
2. _cache_lock still exists for SDK client caching
3. _WORKSPACE_CLIENTS dict exists
"""
import asyncio
import sys
from pathlib import Path

import pytest

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
```

- [ ] **Step 4: Run concurrency tests**

```bash
python -m pytest tests/test_blocks_concurrency.py -v 2>&1
```

Expected: PASS all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add chat_server.py tests/test_blocks_concurrency.py
git commit -m "refactor: remove SQLite DB layer and update concurrency tests"
```

---

## Task 5: Update docs and remove DB test file

**Files:**
- Modify: `DOCS_BLOCKS_MODE.md` — remove all DB references
- Delete: `tests/test_blocks_db.py`

**What to change in docs:**

Remove or update:
- "Persistence" section: remove table schema, replace with "Blocks are stored in SDK JSONL automatically"
- "How It Works Internally" step 4: remove "Persists to database"
- "Error Handling" table: remove DB failure row
- "Summary" section: remove "enriched_blocks column in session_meta"

Update to say: blocks are stored in SDK's JSONL files as `StructuredOutput` tool calls — no separate DB needed.

- [ ] **Step 1: Rewrite doc sections** — Remove all DB references.

- [ ] **Step 2: Delete DB test file**

```bash
rm tests/test_blocks_db.py
```

- [ ] **Step 3: Commit**

```bash
git add DOCS_BLOCKS_MODE.md
git rm tests/test_blocks_db.py
git commit -m "refactor: remove DB layer — docs updated, DB tests removed"
```

---

## Task 6: Full verification

**Files:**
- Run: All tests

- [ ] **Step 1: Start server**

```bash
python chat_server.py &
sleep 3
```

- [ ] **Step 2: Run all tests**

```bash
python -m pytest tests/ -v 2>&1
```

Expected: 12 tests PASS (3 core + 4 concurrency + 4 integration + 1 jsonl).

- [ ] **Step 3: Manual curl verification**

```bash
# Send blocks mode request and capture thread_id
THREAD=$(curl -s -N -X POST http://localhost:8225/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Return 1 block about Python.", "response_mode": "blocks"}' | \
  grep '"thread_id"' | python3 -c "import sys,json; print(json.load(sys.stdin)['thread_id'])")

# Query blocks from JSONL (via API)
curl -s "http://localhost:8225/api/sessions/${THREAD}/messages" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"Messages: {len(d['messages'])}, Blocks: {len(d.get('enriched_blocks') or [])}\")"
```

Expected: Messages > 0, Blocks > 0.

- [ ] **Step 4: Kill server**

```bash
pkill -f "python chat_server.py"
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: full verification — DB removed, blocks from JSONL"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Parse StructuredOutput from JSONL | Task 1 |
| `get_session_messages` uses JSONL | Task 2 |
| Remove DB persistence call | Task 3 |
| Remove all DB code + fix concurrency tests | Task 4 |
| Update docs + remove DB tests | Task 5 |
| Full verification | Task 6 |

### Placeholder scan

- No "TBD", "TODO", "implement later"
- No "Add appropriate error handling" without specifics
- All code is complete and runnable

### Type consistency

- `_read_sdk_history_and_blocks(workspace: str, session_id: str) -> tuple[list[dict], list[dict]]`
- `MessagesResponse` unchanged (`enriched_blocks: list[dict] | None`)
- `get_session_messages` return type unchanged
- Concurrency tests updated to test removal of `_db_lock`, `get_db`
