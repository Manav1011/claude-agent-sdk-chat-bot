# Blocks Mode — Implementation Guide (Backend)

## Overview

**Blocks mode** is an optional structured response format that returns organized content blocks with both Markdown rendering and spoken explanations for text-to-speech (TTS).

Enable with `response_mode: "blocks"` in the chat request.

## Request Schema

```python
class ChatRequest(BaseModel):
    message: str
    thread_id: str | None = None
    workspace: str | None = None
    response_mode: Literal["normal", "blocks"] = "normal"
```

## SSE Event Flow

### Normal Mode
```
1. thinking_delta*        ← Model thinking (streaming)
2. text_delta*            ← Response text (streaming)
3. tool_result*           ← MCP tool calls (if any)
4. context_usage          ← Token usage breakdown
5. done                   ← Final event with usage and response_mode
```

### Blocks Mode
```
1. thinking_delta*        ← Model thinking (streaming)
2. tool_result*           ← MCP tool calls (if any)
3. error                  ← Sent ONLY if structured output fails
4. content_block*         ← Enriched blocks (atomic, one event per block)
5. done                   ← Final event with response_mode="blocks" and block_count
```

**Emission order guarantee:** `content_block` events are emitted to the client BEFORE persisting to the database. If the database write fails, the client has already received the blocks.

**Error handling:** If the LLM does not return valid structured output, the server emits an `error` SSE event followed by a `done` event with `response_mode: "normal"` (fallback to normal mode).

## Content Block Schema

### LLM-Generated (What the model produces)
```python
class ContentBlock(BaseModel):
    markdown: str           # Markdown for visual rendering
    spoken_explanation: str # Natural-language explanation for TTS

class AgentResponse(BaseModel):
    blocks: list[ContentBlock]
```

### Server-Enriched (What the API emits)
```python
class EnrichedContentBlock(BaseModel):
    uuid: str               # Deterministic UUID (hash of sequence_id + markdown)
    sequence_id: int        # 1-based sequential position
    markdown: str           # From model
    spoken_explanation: str # From model
```

**UUID stability:** The same block content + sequence_id always produces the same UUID via `uuid.uuid5(NAMESPACE_URL, f"{i}:{markdown[:200]}")`.

## Persistence

Blocks are stored in the `enriched_blocks` table:

```sql
CREATE TABLE enriched_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    message_index INTEGER NOT NULL,
    blocks_json TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_enriched_blocks_thread_message
    ON enriched_blocks (thread_id, message_index);
```

- `thread_id` = SDK session UUID
- `message_index` = 0 for first message, 1 for second, etc.
- Blocks are stored per-message, not per-session (no overwrites)
- `_get_enriched_blocks` returns the latest message's blocks

## Error Handling

| Error | SSE Event | Response |
|-------|-----------|----------|
| LLM returns no structured_output | `error` | `done` with `response_mode: "normal"` |
| LLM returns malformed JSON | `error` | `done` with `response_mode: "normal"` |
| DB write fails (after emit) | (none) | `done` with `response_mode: "blocks"` (blocks already delivered) |

## How It Works Internally

1. Frontend sends `POST /api/chat` with `response_mode: "blocks"`
2. Backend sets `opts.output_format` to `{"type": "json_schema", "schema": AgentResponse.model_json_schema()}`
3. SDK client receives `AgentResponse` structured output on `ResultMessage.structured_output`
4. Backend validates via `AgentResponse(**msg.structured_output)`
5. Backend calls `_enrich_blocks()` which generates deterministic UUIDs
6. Backend emits `content_block` SSE events to client
7. Backend persists blocks to DB (non-fatal if it fails)
8. Backend emits `done` event with `response_mode: "blocks"` and `block_count`

## Testing

The test suite (`tests/test_blocks_*.py`) covers:
- `test_blocks_core.py` — `_enrich_blocks` deterministic UUIDs
- `test_blocks_stream.py` — SSE flow with live server
- `test_blocks_db.py` — per-message persistence
- `test_blocks_concurrency.py` — TOCTOU safety
- `test_blocks_tools.py` — tool event emission

Run: `python -m pytest tests/test_blocks_*.py -v`

## Future Extension: Block-Context Questions

```bash
# User asks about a specific block
curl -X POST http://localhost:8225/api/blocks/{uuid}/explain \
  -H "Content-Type: application/json" \
  -d '{"message": "Can you explain this further?"}'
```

This would:
1. Retrieve block by UUID
2. Add block context to prompt
3. Generate response with reference to the block
```
