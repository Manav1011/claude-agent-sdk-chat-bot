# Claude Agent SDK — Migration Findings

**SDK version tested:** 0.2.82
**Test date:** 2026-08-20

---

## Test Results Summary

| Test | Status | Notes |
|---|---|---|
| 1. Basic streaming | ✅ PASS | All event types confirmed |
| 2. Tool call streaming | ✅ PASS | Tool results not streamed; handled internally |
| 3. Structured output | ✅ PASS | `structured_output` on ResultMessage |
| 4. Session resume | ✅ PASS | `session_id`=UUID, `resume`=any string |
| 5. Skills | ✅ PASS (with caveat) | Omit `skills` entirely; `skills=[]` and `skills="all"` both hang |
| 6. Tool permissions | ⚠️ SOFT | `allowed_tools`/`disallowed_tools` don't hard-block; not a regression |
| 7. System prompt | ⚠️ UNCLEAR | Test too simple; all returned "1, 2, 3." |
| 8. Multi-turn client | ✅ PASS | `connect→query→receive_response` loop |
| 9. Env / API key | ✅ PASS | Pass via `options.env={}` |

---

## 1. Streaming Architecture

### Event Types (in order)

```
HookEventMessage        — hook_started / hook_response (skip for migration)
SystemMessage          — init (session info), status
StreamEvent            — message_start
StreamEvent            — content_block_start (index, block type)
StreamEvent            — content_block_delta (delta.type: thinking_delta | text_delta | input_json_delta | signature_delta)
StreamEvent            — content_block_stop (index)
StreamEvent            — message_delta (stop_reason, usage)
StreamEvent            — message_stop
AssistantMessage       — accumulated blocks for the turn
ResultMessage          — final result + structured_output
```

### Key Findings

- **`content_block_delta` delta types:**
  - `thinking_delta` — thinking tokens (not shown to end user)
  - `text_delta` — actual response text chunks
  - `input_json_delta` — partial JSON args for tool calls (accumulates incrementally)
  - `signature_delta` — model reasoning signature
- **`input_json_delta` accumulates incrementally** — same pattern as current `pending_tools` logic
- **`AssistantMessage` arrives after `content_block_stop`** — contains accumulated block content
- **Tool results are NOT streamed as `UserMessage`** — subprocess handles execution internally. The caller never sees tool result content. Next `message_start` begins the next turn.

### SSE Mapping

| Current SSE | SDK Equivalent |
|---|---|
| `type: thinking_delta` | `content_block_delta` with `delta.type: thinking_delta` |
| `type: text_delta` | `content_block_delta` with `delta.type: text_delta` |
| `type: tool_result` | **Not in stream** — handled internally |
| `type: human` | Not emitted |
| `type: content_block` (blocks mode) | `structured_output` on `ResultMessage` |
| `done` event | `ResultMessage` arrives |

### Streaming Code Pattern

```python
async for message in query(prompt, options=ClaudeAgentOptions(
    model="ornith-1.0",
    env={"ANTHROPIC_BASE_URL": "http://localhost:8083/anthropic", "ANTHROPIC_API_KEY": "..."},
    include_partial_messages=True,
)):
    if isinstance(message, StreamEvent):
        evt = message.event
        evt_type = evt.get('type')

        if evt_type == 'content_block_delta':
            delta = evt.get('delta', {})
            d_type = delta.get('type')
            if d_type == 'text_delta':
                emit_sse('text_delta', delta.get('text', ''))
            elif d_type == 'input_json_delta':
                accumulate_args(evt.get('index'), delta.get('partial_json', ''))
            elif d_type == 'thinking_delta':
                emit_sse('thinking_delta', delta.get('thinking', ''))

        elif evt_type == 'content_block_start':
            cb = evt.get('content_block', {})
            if cb.get('type') == 'tool_use':
                register_tool_call(cb.get('id'), cb.get('name'), evt.get('index'))

        elif evt_type == 'message_delta':
            pass  # final usage per turn

        elif evt_type == 'message_stop':
            pass

    elif isinstance(message, ResultMessage):
        # done
        structured = message.structured_output  # dict or None
```

---

## 2. Structured Output

Works as documented. `output_format={"type": "json_schema", "schema": {...}}` on `ClaudeAgentOptions`.

```python
schema = AgentResponse.model_json_schema()  # same schema as schemas.py

options = ClaudeAgentOptions(
    model="ornith-1.0",
    env={...},
    include_partial_messages=True,
    output_format={"type": "json_schema", "schema": schema},
)
```

On `ResultMessage`:
- `result: str` — plain text, all turns combined
- `structured_output: dict | None` — validated JSON (raw dict, not Pydantic)
- `num_turns: int`

```python
# Server must deserialize
if result.structured_output:
    blocks = [ContentBlock(**b) for b in result.structured_output['blocks']]
```

The UUID/sequence_id enrichment (`_enrich_blocks()`) stays as server-side post-processing — unchanged.

---

## 3. Session Management

### `session_id` vs `resume`

- **`session_id`**: Creates a new session. **Must be a valid UUID** (`uuid.uuid4()`).
- **`resume`**: Resumes existing session. Accepts **any string** (e.g. `"thread-123"`). No UUID required.

```python
# First request — create session
options = ClaudeAgentOptions(session_id=str(uuid.uuid4()), ...)

# Subsequent requests — resume
options = ClaudeAgentOptions(resume="thread-123", ...)
```
### FastAPI Mapping

| Current | SDK |
|---|---|
| `thread_id` (langgraph checkpoint key) | `session_id` IS the `thread_id` — a UUID string, stored in `session_meta` |
| `AsyncSqliteSaver` + `aget_state()` | **Gone** — SDK uses filesystem storage by default |
| `checkpoints` + `writes` tables | **Gone** — SDK stores transcripts as JSONL at `~/.claude/projects/<cwd-hash>/<session-id>.jsonl` |
| `ResultMessage.session_id` on resume | Returns the string you passed in `resume=`. Store it in `session_meta`. |
| Session resumption | `resume="<thread_id>"` + same `cwd` → SDK finds the JSONL file |

**`cwd` determines session scope:** Sessions are stored at `~/.claude/projects/<project-key>/`, where `project-key` is derived from `cwd`. One workspace = one session directory. All sessions for a workspace are grouped together and shown when that workspace is selected.

**What stays in the DB:** Only `session_meta` — `thread_id`, `workspace`, `first_message`, `created_at`. The DB is now an index, not a store.

**What goes:** `checkpoints` table, `writes` table, `AsyncSqliteSaver`, `_checkpointer` global.

### `ClaudeSDKClient` for Multi-Turn

```python
client = ClaudeSDKClient(options=ClaudeAgentOptions(
    model="ornith-1.0",
    env={...},
    include_partial_messages=True,
))
await client.connect()

# Turn 1
await client.query(prompt="hello")
async for msg in client.receive_response():
    if isinstance(msg, ResultMessage):
        thread_id = msg.session_id  # store this string in DB
        break

# Turn 2 — same thread, same client
await client.query(prompt="follow up")
async for msg in client.receive_response():
    ...

# Can disconnect and reconnect — starts fresh session
await client.disconnect()
await client.connect()
```

**Lifecycle confirmed:**
- Same client instance reusable: `disconnect()` + `connect()` starts a fresh session (previous context cleared).
- `disconnect()` clears session history. Keep calling `query()` without disconnecting to preserve context.
- `connect()`, `query()`, `receive_response()` return coroutines (stubs incorrectly say `None`).
- If subprocess crashes: `query()` fails with `ResultMessage(subtype='error_during_execution')`, zeroed cost fields.

**`receive_response()` + `output_format`:**
- `structured_output` on the **same** `ResultMessage` as `result: str` — same message, both fields populated.
- Intermediate `StreamEvent` (thinking_delta, text_delta, tool call events) all still emitted during iteration.
- `structured_output` only in the final `ResultMessage`, not streamed incrementally.

---

## 4. Skills

**Never pass the `skills` option at all** — omit it entirely.

- `skills=[]` — hangs immediately, even on trivial prompts
- `skills="all"` — also hangs
- `skills` omitted — works; auto-discovers skills from `~/.claude/skills/` and `{cwd}/.claude/skills/`

The `cwd` option controls where the SDK looks for project-local skills. Auto-discovery via `setting_sources` (defaults to `['user', 'project', 'local']`). Just don't touch it.

---

## 5. Tool Permissions

**`allowed_tools` and `disallowed_tools` do not hard-block tools** in this setup.

- `allowed_tools=['Read']` — `Bash echo hello` still executes
- `disallowed_tools=['Bash']` — `Bash` still executes
- `permission_denials: []` always empty

Not a regression — current server also doesn't restrict tools. Don't use these for security. If restrictions are needed: `permission_mode="acceptEdits"` auto-approves file edits (works reliably).

---

## 6. Environment / API Key

**Pass via `options.env={}`, not `os.environ`:**

```python
ClaudeAgentOptions(
    model="ornith-1.0",
    env={
        "ANTHROPIC_BASE_URL": "http://localhost:8083/anthropic",
        "ANTHROPIC_API_KEY": "97f5482590888eaa0afe9e173babd87c9abae1f5"
    },
)
```

The SDK subprocess inherits the parent environment, but explicit `options.env` is more reliable.

---

## 7. System Prompt

- `system_prompt=None` — minimal tool-calling loop, no persona
- `system_prompt="You are a pirate..."` — custom persona
- `system_prompt={"type": "preset", "preset": "claude_code"}` — full Claude Code coding persona

For the current chat app: use `system_prompt=None` for a neutral assistant.

---

## 8. `ClaudeAgentOptions` Key Fields

```python
ClaudeAgentOptions(
    model="ornith-1.0",
    env={"ANTHROPIC_BASE_URL": "...", "ANTHROPIC_API_KEY": "..."},
    system_prompt=None,                          # or str, or preset dict
    cwd="/path/to/workspace",                    # subprocess working dir; also controls where .claude/skills/ is looked up
    session_id=str(uuid.uuid4()),               # create session (must be UUID)
    resume="thread-123",                        # resume existing (any string)
    include_partial_messages=True,                # enable streaming
    output_format={"type": "json_schema", "schema": {...}},
    permission_mode="acceptEdits",               # works reliably
    max_turns=10,
    max_budget_usd=1.0,
    max_thinking_tokens=1000,
    thinking={"type": "adaptive", "budget_tokens": 1000},  # or "disabled"
)
```

**Never use:** `skills`, `allowed_tools`, `disallowed_tools` (see above).

---

## 9. Migration: What Changes in chat_server.py

### Stays the same
- FastAPI routes, SSE endpoint, `StreamingResponse`
- Frontend — consumes SSE events unchanged
- `ContentBlock` / `AgentResponse` / `EnrichedContentBlock` schemas
- `_enrich_blocks()` — UUID/sequence_id post-processing
- `session_meta` SQLite table


### Changes

| Component | Old | New |
|---|---|---|
| Agent | `create_deep_agent()` | `ClaudeSDKClient` |
| Streaming | `agent.astream()` | `await client.query() → async for msg in client.receive_response()` |
| Tool args | langgraph `input_json_delta` chunks | SDK `content_block_delta` with `delta.type: input_json_delta` |
| Tool results | `UserMessage` in stream | Not in stream — handled internally |
| Structured | `response_format=AgentResponse` + `aget_state()` | `output_format` + `ResultMessage.structured_output` |
| Session create | `thread_id` as langgraph checkpoint key | `session_id` IS the `thread_id` (UUID string, stored in `session_meta`) |
| Session resume | langgraph checkpoint read | `resume="<thread_id>"` + same `cwd` |
| Multi-turn | `agent.astream()` + `aget_state()` | Same `ClaudeSDKClient` instance, repeated `query()` calls |
| Session persistence | `AsyncSqliteSaver` + `checkpoints/writes` tables | **Gone** — SDK JSONL files at `~/.claude/projects/<cwd-hash>/<session-id>.jsonl` |
| Workspace scoping | `FilesystemBackend(root_dir=...)` | `options.cwd="/path/to/workspace"` |
| Skills | `backend.get_skills()` | Auto-discovered via `cwd`; omit `skills` option |
| DB tables | `checkpoints`, `writes` + `session_meta` | Only `session_meta` stays |

### Things that NEED DECISION

1. **`ClaudeSDKClient` per-workspace caching**: Store one `ClaudeSDKClient` per workspace, reused across all threads. Same instance makes multiple `query()` calls without reconnecting. On workspace switch, create new client for the new `cwd`.
2. **`cwd` sandboxing**: No hard sandbox — `Read("/etc/passwd")` is possible. If isolation is needed, use OS-level restrictions.
3. **`system_prompt`**: What persona? `None` = minimal tool-calling loop, `{"type": "preset", "preset": "claude_code"}` = full Claude Code persona, or a custom string.

### Things that ARE GONE
- `langgraph` / `deepagents` / `ChatAnthropic`
- `MultiServerMCPClient`
- `FilesystemBackend`
- `AsyncSqliteSaver`
- `checkpoints` and `writes` DB tables
- `_checkpointer` global
- `backend.get_unique_id()`, `backend.get_skills()`, `backend.create_file_data()`
- `stream_mode="messages"`, `subgraphs=True`, `version="v2"` (langgraph-specific)
- `_resolve_skills()` (skills auto-discovered via `cwd`)
- `aget_state()` (SDK reads JSONL on resume automatically)
