# WEBCLAUDE

> A web-based frontend that turns the Claude Agent SDK into a streaming chat service. Single Python file on the back, single React app on the front, SSE pipe in between.

## 1. What it is

**WebClaude** is a self-hosted, browser-based chat client for Claude that exposes the full **Claude Agent SDK** (tool use, file editing, code execution, permission prompts, multi-turn sessions) as a streaming UI. The agent runs server-side in a Python subprocess managed by the SDK; the browser receives every token delta, tool call, permission request, and usage snapshot over **Server-Sent Events**.

Everything goes through it — there is no other path to the agent. The backend owns the SDK subprocess, the frontend owns no logic that touches Claude directly.

### High-level shape

```
┌──────────────────────────────────────────────────────────────────┐
│                          Browser (React)                         │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ ChatCtx  │  │  SSE client  │  │  fetch()   │  │  EventSource│ │
│  └────┬─────┘  └──────┬───────┘  └─────┬──────┘  └──────┬──────┘ │
└───────┼───────────────┼────────────────┼────────────────┼────────┘
        │ POST msg      │ GET events     │ projects/perm  │
        ▼               ▼                ▼                ▲
┌──────────────────────────────────────────────────────────────────┐
│                  FastAPI  (chat_server.py :8225)                │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │ /api/*   │  │ SessionLoop  │  │  Piper TTS  │  │ SQLite    │ │
│  │ routes   │  │  per-session │  │  /api/tts   │  │ projects  │ │
│  └────┬─────┘  └──────┬───────┘  └─────┬───────┘  └─────┬─────┘ │
│       │               │                │                │       │
│       └─────►  ClaudeSDKClient  ◄─────┘                │       │
│                      │                                  │       │
│                      ▼                                  │       │
│              ┌─────────────────┐                        │       │
│              │  SDK subprocess │                        │       │
│              │  (claude CLI)   │                        │       │
│              └────────┬────────┘                        │       │
│                       │  writes                         │       │
│                       ▼                                 │       │
│            ~/.claude/projects/<key>/                    │       │
│            <session_id>.jsonl                           │       │
└──────────────────────────────────────────────────────────────────┘
```

## 2. Repository layout

```
explainer-bot/
├── chat_server.py                 ← entire backend, ~1460 lines
├── schemas.py                     ← Pydantic DTOs (Project, ProjectCreate, …)
├── projects.db                    ← SQLite: only the projects index
├── requirements.txt               ← fastapi, pydantic, claude-agent-sdk, piper-tts
├── start_webclaude.sh             ← boot server + cloudflared tunnel
├── restart_server.sh, stop_webclaude.sh
├── index.html                     ← legacy vanilla UI (still served at /)
├── maximalism/, retro/, industrial/index.html   ← alt UI shells
├── FE/                            ← React + Vite app (the main frontend)
│   ├── package.json, vite.config.js, tailwind.config.js
│   ├── index.html
│   ├── public/                    ← manifest.webmanifest, sw.js, icons
│   ├── dist/                      ← build output (served by FastAPI)
│   └── src/
│       ├── main.jsx, App.jsx, index.css
│       ├── context/ChatContext.jsx       ← single source of UI truth
│       ├── utils/{api.js, helpers.js, markdown.js}
│       └── components/
│           ├── Chat/    (Messages, HumanMessage, AiMessage, ThinkingMessage,
│           │            ToolCallMessage, SpeechPlayer, PermissionPrompt,
│           │            SelectionPopup, MarkdownRenderer)
│           ├── Input/   (ChatInput, ContextUsagePill, QuickVoiceButton)
│           ├── Header/  (Header, TabBar, TabSwitcher)
│           ├── Sidebar/ (ProjectsHeader, ProjectItem, SessionItem, AddProjectForm,
│           │             AppBrand)
│           ├── Modals/  (SettingsModal, ContextModal, ImageLightboxModal)
│           └── Notifications/
├── CLAUDE_AGENT_SDK_MIGRATION.md  ← SDK findings (read this for streaming details)
└── test_01_…test_08_*.py          ← SDK smoke tests
```

The codebase is intentionally minimal — no microservices, no message broker, no Docker. One process, one file.

## 3. Backend: `chat_server.py`

### 3.1 Stack and lifecycle

- **Framework**: FastAPI on Uvicorn (`uvicorn.run(app, host="0.0.0.0", port=8225)`)
- **Concurrency model**: asyncio. SDK is awaited directly; TTS synthesis is offloaded to a `ThreadPoolExecutor` (Piper is CPU-bound, blocks the loop).
- **Lifespan** (`async def lifespan(app)`):
  1. `_init_db()` — create `projects` table in `projects.db` if missing.
  2. `_load_piper_model()` — warm-load `en_US-ryan-medium.onnx` (or `lessac`) into memory.
  3. On shutdown: clear `_WORKSPACE_CLIENTS`, call `shutdown()` on every active `SessionLoop` so SDK subprocesses disconnect cleanly, then `shutdown(wait=False)` the TTS executor.

### 3.2 Configuration

Three env vars, all read at module load:

| Var | Default | Used for |
|---|---|---|
| `LLM_MODEL` | `MiniMaxAI/MiniMax-M3` | `ClaudeAgentOptions.model` |
| `LLM_API_KEY` | hardcoded JWT | passed as `ANTHROPIC_API_KEY` to SDK subprocess |
| `LLM_BASE_URL` | `http://localhost:8083/anthropic` | passed as `ANTHROPIC_BASE_URL` |

The SDK subprocess inherits `ANTHROPIC_*` from the FastAPI env, but we set them explicitly via `options.env={...}` for reliability. Also `API_TIMEOUT_MS=3000000` and retry `CLAUDE_CODE_RETRY_WATCHDOG=1`, `CLAUDE_CODE_MAX_RETRIES=10`.

Auth is a single shared password compared as a string literal at `/api/auth/verify`: `MS@1011`. Not a session, not a token — just a gate.

### 3.3 The Claude Agent SDK integration

This is the core. Only `chat_server.py` imports the SDK.

```python
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, PermissionMode
from claude_agent_sdk import ResultMessage, StreamEvent, list_sessions as sdk_list_sessions
from claude_agent_sdk.types import (
    PermissionResultAllow, PermissionResultDeny,
    SettingSource, ToolPermissionContext,
)
```

There are no MCP servers configured and no custom SDK tools — the agent comes with the SDK's full default toolset (Read, Glob, Grep, Bash, Write, Edit, MultiEdit, NotebookEdit, WebFetch, WebSearch, …).

#### 3.3.1 `SessionLoop` — one per session

Every `(workspace, session_id)` pair gets exactly one `SessionLoop`, kept in a process-wide dict `_SESSION_REGISTRY`. Created lazily by `get_or_create_loop()` when the first event arrives.

Each loop owns:
- one `ClaudeSDKClient` (built lazily on first message, reused thereafter),
- one `asyncio.Queue` for incoming user messages (`_incoming`),
- a `set` of subscriber `asyncio.Queue`s (one per SSE client),
- an `_idle_watcher` background task that shuts the loop down after 30 minutes idle, and
- a `_context_usage_ticker` that polls `client.get_context_usage()` every 10s.

It does **not** own its own thread — everything runs in the FastAPI event loop. The SDK client itself runs a subprocess internally.

#### 3.3.2 Client construction (`_build_client`)

```python
opts = ClaudeAgentOptions(
    model=LLM_MODEL,
    system_prompt=system_prompt,   # None by default — neutral assistant
    env={ "ANTHROPIC_API_KEY": ..., "ANTHROPIC_BASE_URL": ..., ... },
    cwd=workspace,                 # sets scope: ~/.claude/projects/<key>/<session>.jsonl
    resume=session_id  if resume else None,   # resuming an existing session
    session_id=session_id if not resume else None,  # creating a new one
    include_partial_messages=True,  # required for streaming
    setting_sources=setting_sources,
    skills=skills,
    permission_mode=cast(PermissionMode, sdk_mode),
    allowed_tools=allowed_tools or [],
    disallowed_tools=disallowed_tools or [],
)
self._client = ClaudeSDKClient(opts)
await self._client.connect()
```

A session is resumed iff the SDK JSONL file at `~/.claude/projects/<project_key>/<session_id>.jsonl` already exists; otherwise a fresh `session_id` (UUID) is created. The project's `cwd` is what scopes which JSONL directory is used — switching workspaces = switching scope = new conversation tree.

> SDK gotcha: passing `skills=[]` (empty list) **hangs** the SDK. The server coerces it to `None` so the default auto-discovery kicks in. Same for `skills="all"`.

#### 3.3.3 Turn loop (`_loop_body`)

```
loop forever (until shutdown):
    msg = await _incoming.get()
    if first message: build client, lock settings
    build a small async generator that yields one {"type":"user", ...} dict
    await client.query(generator, session_id=...)
    async for sdk_event in client.receive_response():
        for legacy_event in _translate_sdk_message(sdk_event, ...):
            await _broadcast(legacy_event)   # fan out to every SSE subscriber
    await _client.get_context_usage()  # final per-turn usage snapshot
```

Two important details:
- **Settings are locked on the first message.** `_locked_settings` is frozen after the SDK client is built. Late messages with new `setting_sources` / `skills` are ignored — changing them mid-stream would require tearing down the client and losing conversation context.
- **Live permission-mode changes work.** `_current_permission_mode` is updated on every enqueued message and read by the per-tool `can_use_tool` callback, so the FE can flip `default ⇄ bypassPermissions ⇄ read_only` between turns without rebuilding the client.

#### 3.3.4 SDK → FE event translation (`_translate_sdk_message`)

The SDK emits a different vocabulary than the frontend expects. `_translate_sdk_message` converts on the fly so the React app sees the same event shape it always has:

| SDK event | Legacy FE event | Notes |
|---|---|---|
| `StreamEvent` `content_block_start` (type=tool_use) | _internal_ | register pending tool call in `_pending_tools` by index |
| `StreamEvent` `content_block_delta` (text_delta) | `text_delta {content}` | forward `delta.text` |
| `StreamEvent` `content_block_delta` (thinking_delta) | `thinking_delta {content}` | forward `delta.thinking` |
| `StreamEvent` `content_block_delta` (input_json_delta) | _internal_ | append `delta.partial_json` to the pending tool's `args_str` |
| `StreamEvent` `message_delta` | _internal_ | accumulate `usage.prompt_tokens` / `completion_tokens` |
| `StreamEvent` `message_stop` | `tool_result {tool_name, tool_id, args}` | one per pending tool — final parsed args |
| `AssistantMessage` (TextBlock) with `API Error` or `error` | `text_delta {content}` | SDK sometimes routes error text here instead of as deltas |
| `ResultMessage` | `done {thread_id, usage}` | per-turn terminus |

After `message_stop`, the tool's actual result content is not in the stream — the SDK subprocess handles execution internally. The server tails the session JSONL file (`_tail_jsonl_for_tool_results`) to surface the result, then broadcasts `tool_result_content {tool_id, content}`. The FE reducer joins this back to the matching tool call by `tool_id`.

### 3.4 Permission system

The SDK's `can_use_tool` callback is the sole permission authority for the live session:

```python
async def can_use_tool(tool_name, tool_input, context):
    mode = self._current_permission_mode
    if mode == "bypassPermissions":
        return PermissionResultAllow(updated_input=tool_input)        # auto-allow
    if mode == "read_only" and tool_name not in _READ_ONLY_TOOLS:
        return PermissionResultDeny(message="read-only mode", ...)  # hard-deny
    # otherwise: ask the frontend
    fut = asyncio.Future()
    _permission_futures[(self.session_id, request_id)] = fut
    await self._broadcast({"type": "permission_request", ...})
    decision = await asyncio.wait_for(fut, timeout=300)
    return PermissionResultAllow(...) if decision["decision"]=="allow" \
       else PermissionResultDeny(...)
```

Three modes (`_MODE_PROFILES`):

| FE mode | SDK mode | Tools exposed |
|---|---|---|
| `default` | `default` | full SDK toolset; every call surfaces to FE |
| `bypassPermissions` | `bypassPermissions` | full toolset; auto-allow, no FE dialog |
| `read_only` | _none_ (SDK kept broad) | allowlist: `Read, Glob, Grep, WebFetch, WebSearch`; hard-deny everything else |
| `plan` | `plan` | SDK workflow mode |

Why the SDK toolset is not narrowed for `read_only`: the SDK's `allowed_tools` / `disallowed_tools` flags are advisory — they do not hard-block. The server enforces read-only in `can_use_tool` instead. (This matches the findings in `CLAUDE_AGENT_SDK_MIGRATION.md`.)

The FE permission dialog can also forward `updated_input` (allow with edits) and `answers` (for `AskUserQuestion`).

### 3.5 Session persistence

Sessions live as JSONL files written by the SDK subprocess:

```
~/.claude/projects/<project_key>/<session_id>.jsonl
```

`<project_key>` is derived from `cwd` (the workspace path with `/` and `.` replaced by `-` and prefixed with `-`). All sessions for a workspace are grouped under one project key.

The server reads them in two ways:

1. **Live tailing** during streaming — `_tail_jsonl_for_tool_results` opens the file, seeks to the byte offset recorded before `client.query()`, reads the new bytes, extracts any `tool_result` blocks, broadcasts each as a `tool_result_content` event.

2. **History reload** on session open — `_read_sdk_history` reads the full file, parses entries, assembles a chronological `messages` list (`human`, `ai` with `thinking`/`content`/`speech_explanation`, `tool` with name/input/content), supports byte-offset pagination via `cursor`.

The DB **only** stores project metadata (id, name, path, created_at) — never conversation content. SQLite is purely an index for the workspace selector. Conversation history is owned entirely by the SDK filesystem format.

### 3.6 SSE wire protocol

The events endpoint (`GET /api/sessions/{session_id}/events`) sends Server-Sent Events:

```
id: 142
event: message
data: {"type":"text_delta","content":"Hello"}

event: heartbeat
data: {"ts": 1735620000.123}

id: 143
event: message
data: {"type":"tool_result","tool_name":"Read","tool_id":"abc","args":{...}}
```

Rules baked into the implementation:

- Every event frame carries a **monotonic `id`** (`_event_seq`) so reconnecting browsers can replay missed frames via `Last-Event-ID`.
- Heartbeats are sent every 15s of silence, and **carry no `id`** — per the HTML5 SSE spec, `lastEventId` only updates on `id:` lines. A heartbeat that bumped the id would corrupt the replay cursor.
- A bounded ring buffer (`collections.deque(maxlen=2000)`) per session stores recent `(eid, event)` tuples for replay.
- `Cache-Control: no-cache`, `Connection: keep-alive`.

Full event vocabulary the FE reducer handles:

| Event type | Shape | Source |
|---|---|---|
| `text_delta` | `{content}` | SDK text delta |
| `thinking_delta` | `{content}` | SDK thinking delta |
| `tool_result` | `{tool_name, tool_id, args}` | SDK message_stop |
| `tool_result_content` | `{tool_id, content}` | JSONL tail |
| `permission_request` | `{request_id, tool_name, tool_input, ...}` | can_use_tool |
| `context_usage` | `{data}` | periodic poll or per-turn |
| `done` | `{thread_id, usage}` | ResultMessage |
| `error` | `{message}` | session/transport failure |

### 3.7 Piper TTS

`/api/tts?q=...` synthesizes speech on demand.

- Model: Piper neural voice (`en_US-ryan-medium.onnx` or `en_US-lessac-medium.onnx` whichever is on disk).
- Synthesis runs in a dedicated `ThreadPoolExecutor(max_workers=min(4, cpu_count))` so the asyncio loop stays responsive.
- Cache: in-process `OrderedDict` LRU keyed by `sha256(text)`, capped at 300 entries, mutex-locked.
- Cache headers: `Cache-Control: public, max-age=86400, immutable`, plus `X-Cache: HIT|MISS` for debugging.
- Fallback: Google Translate `translate_tts` returns MP3 if Piper is absent or fails.

The frontend's `SpeechPlayer` reads `speech_explanation` off AI messages and calls this endpoint for audio playback — only on AI turns that opt in by emitting the field.

### 3.8 The full HTTP surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/verify` | Password gate (literal `MS@1011`) |
| GET | `/api/health` | Liveness |
| GET | `/api/debug/usage` | One-off SDK usage probe |
| GET | `/api/sessions` | List sessions (via `sdk_list_sessions(directory=ws)`) |
| GET | `/api/sessions/{sid}/messages?cursor=…&limit=…` | Paginated JSONL read |
| DELETE | `/api/sessions/{sid}` | No-op (SDK JSONL deletion unsupported) |
| DELETE | `/api/sessions` | No-op |
| GET | `/api/projects` | List projects (SQLite) |
| POST | `/api/projects` | Add project `{name, path}`; auto-validates path is a directory |
| DELETE | `/api/projects/{id}` | Remove project from index (does not delete files) |
| GET | `/api/projects/{id}/sessions?limit=…&offset=…` | Project's sessions via SDK |
| POST | `/api/workspaces/select` | `{workspace}` → `{thread_id: uuid}` |
| GET | `/api/workspaces/current?session_id=…` | Resolve session → workspace |
| GET | `/api/tts?q=…` | Piper (or Google fallback) TTS |
| GET | `/api/permissions/pending?thread_id=…` | List unresolved permission futures |
| POST | `/api/permissions/decision` | `{request_id, session_id, decision, updated_input?, answers?, message?}` |
| POST | `/api/sessions/{sid}/messages?workspace=…` | Queue user message; body = `_UserMessage` |
| GET | `/api/sessions/{sid}/events?workspace=…` | Long-lived SSE stream (supports `Last-Event-ID`) |
| POST | `/api/sessions/{sid}/interrupt?workspace=…` | Cancel in-flight turn |
| GET | `/`, `/maximalist-ui`, `/retro-ui`, `/industrial-ui` | Serve HTML shells |
| GET | `/assets/*`, `/manifest.webmanifest`, `/sw.js`, `/icon*`, `/apple-touch-icon.png` | PWA shell assets |

### 3.9 Frontend serving

FastAPI mounts `/assets` (Vite's hashed bundle directory) if present. The PWA shell files (`manifest.webmanifest`, `sw.js`, icons) are served by individual `FileResponse` routes with explicit MIME types — `StaticFiles("/")` would shadow the rest of the routes, so explicit routes are the smallest correct change. The `manifest.webmanifest` MIME is set explicitly because some proxies guess it wrong and Chrome's installability check rejects bad MIME.

## 4. Frontend: `FE/`

React 18 + Vite 5 + Tailwind 3. The dev server is at the default Vite port and proxies `/api/*` to `http://localhost:8225` (see `FE/vite.config.js`).

### 4.1 State — `ChatContext.jsx`

The single source of UI truth. One big React context holds:

- `sessions` map (id → metadata, message list, cursor),
- one `EventSource` per active session (managed by `createSessionEventSource` from `utils/api.js`),
- `AbortController`s for in-flight POSTs (interrupt support),
- per-session reducers that apply SSE events in order,
- user settings persisted to `localStorage` (theme, permission mode, setting_sources, skills, expand-thoughts).

### 4.2 SSE client (`FE/src/utils/api.js`)

`createSessionEventSource({threadId, workspace})` returns an object with:

- `es` — the underlying `EventSource`,
- `subscribe(cb)` — registers a callback that receives `{event, data, id?}` for every parsed SSE frame,
- `close()` — tears down the source.

It handles the three `onerror` states the browser can fire on:
- `CONNECTING` — silent (transient; browser auto-reconnects),
- `OPEN` — shouldn't fire onerror, but if it does the connection is alive,
- `CLOSED` — terminal; emit a `fatal: true` flag so the caller can recreate the source.

The browser auto-reconnects on transient errors and sets `Last-Event-ID` on retry, which the server uses to replay buffered events.

### 4.3 API helpers (also in `utils/api.js`)

- `verifyPasswordApi(password)`
- `fetchProjects`, `createProject`, `deleteProjectApi`
- `fetchWorkspace`, `selectWorkspace`
- `fetchProjectSessions(projectId, {limit, offset})`
- `fetchSessionMessages(threadId, projectId, cursor, limit)`
- `fetchPendingPermissions(threadId)`
- `submitPermissionDecision({requestId, sessionId, decision, updatedInput, answers, message})`
- `sendSessionMessage({threadId, workspace, content, images, settingSources, skills, permissionMode, signal})`
- `interruptSession({threadId, workspace})`

### 4.4 Components

- **`Chat/`** — message rendering and conversation surface:
  - `MessagesContainer` — virtualized scroll list with auto-scroll-to-bottom.
  - `HumanMessage`, `AiMessage`, `ThinkingMessage`, `ToolCallMessage`.
  - `SpeechPlayer` — plays `/api/tts?q=...` for AI messages that carry a `speech_explanation`.
  - `PermissionPrompt` — modal that surfaces `permission_request` events; resolves via `submitPermissionDecision`.
  - `SelectionPopup`, `MarkdownRenderer` — markdown + selection-driven UI helpers.
- **`Input/`** — `ChatInput` (textarea + image upload + submit), `ContextUsagePill` (renders `context_usage` snapshots), `QuickVoiceButton`.
- **`Header/`** — `Header`, `TabBar`, `TabSwitcher` (multi-session tab UI).
- **`Sidebar/`** — projects list, session items, add-project form, brand.
- **`Modals/`** — `SettingsModal` (permission mode + setting_sources + skills), `ContextModal` (full context-usage detail), `ImageLightboxModal`.
- **`Notifications/`** — toast component for transient errors.

## 5. End-to-end flow

### Cold start: opening the app
1. Browser loads `/` → FastAPI serves `FE/dist/index.html` (or legacy `index.html` if dist missing).
2. React boots, password prompt. POST `/api/auth/verify`. On success, render `<ChatProvider>`.
3. ChatContext fetches `/api/projects`, picks a workspace (or last-used), creates a new session via `POST /api/workspaces/select` → gets `thread_id` (UUID).
4. Opens an SSE connection: `EventSource(/api/sessions/<thread_id>/events?workspace=...)`.
5. Sends first message: `POST /api/sessions/<thread_id>/messages?workspace=...` with `_UserMessage`.
6. Subscribes to incoming SSE events; reducer applies them in order.

### Per turn
1. Backend `get_or_create_loop(workspace, session_id)` finds or starts the session's `SessionLoop`.
2. The new message is enqueued into `_incoming`. `_loop_body` dequeues it.
3. If first message: builds `ClaudeSDKClient`, locks settings.
4. Builds an async generator that yields one `{"type":"user", message:{role:"user", content:[...]}}` dict (text + optional base64 image blocks).
5. `await client.query(generator, session_id=...)`.
6. `async for sdk_event in client.receive_response()`:
   - Every translated legacy event → `_broadcast` → fans out to all SSE subscribers.
   - `_event_seq` increments; `(eid, event)` appended to the ring buffer.
7. After the loop returns: poll `client.get_context_usage()` and broadcast one final `context_usage`.
8. Idle watcher waits 30 min after last activity before shutting the loop down.

### Reconnect after browser drops the SSE
1. Browser auto-reconnects (transient error).
2. Browser sends `Last-Event-ID: <last id received>`.
3. Server replays buffered events with id > last and ≤ buffer snapshot, then continues the live tail.
4. No gap, no overlap.

### Interrupt
1. FE POSTs `/api/sessions/<id>/interrupt?workspace=...`.
2. Server resolves any pending permission futures (deny) and calls `client.interrupt()`.
3. SDK subprocess returns from `receive_response()`, loop waits for next message.

## 6. Features

### Conversation
- Multi-turn streaming chat over SSE.
- Streaming deltas for text, thinking, tool calls, tool results.
- Per-turn `done` event with usage snapshot.
- Session resume: opening a session from the sidebar rebuilds context from the SDK JSONL; the FE reloads message history via `/api/sessions/{id}/messages`.
- Multi-session tabs (TabBar/TabSwitcher).

### Agent / SDK
- Full default SDK toolset (Read, Glob, Grep, Bash, Write, Edit, MultiEdit, NotebookEdit, WebFetch, WebSearch, etc.).
- Live-toggleable permission modes: `default` (ask per tool), `bypassPermissions` (auto-allow), `read_only` (allowlist only).
- `setting_sources` control which `.claude/CLAUDE.md` / `SKILL.md` scopes the agent sees.
- Skills auto-discovered from `~/.claude/skills/` and `<workspace>/.claude/skills/`.
- Permission dialog with allow / deny / `updated_input` / `AskUserQuestion` answers.
- Periodic context-window usage pill (10s polling + per-turn snapshot).
- Interrupt in-flight turn.

### Project workspace
- SQLite-backed project registry (path + display name).
- Workspace-scoped sessions: switching workspace = switching `cwd` = different `~/.claude/projects/<key>/` tree.
- Auto-discover existing sessions per workspace via `sdk_list_sessions(directory=project_path)`.

### Media & attachments
- Image attachments in user messages: `images: [{data, media_type}]` → SDK image blocks (base64).
- Lightbox modal for full-size preview.
- Image thumbnails persist on history reload (mirrored shape in JSONL reader).

### Speech
- Piper neural TTS via `/api/tts`, in-process LRU + thread pool offload.
- Google Translate fallback if Piper unavailable.
- FE `SpeechPlayer` plays audio for AI messages tagged with `speech_explanation`.

### UX
- Light/dark theme.
- Markdown rendering (react-markdown + remark-gfm + rehype-highlight + highlight.js).
- Auto-reconnect SSE with replay.
- Tab visibility catch-up (when the tab becomes visible again, reducer flushes any missed events).
- PWA shell (installable): `manifest.webmanifest`, `sw.js`, icons, apple-touch-icon.

### UI variants
- `/` — main React/Vite UI.
- `/maximalist-ui` — vanilla HTML shell in `maximalism/index.html`.
- `/retro-ui` — vanilla HTML shell in `retro/index.html`.
- `/industrial-ui` — vanilla HTML shell in `industrial/index.html`.

### Operations
- Health check at `/api/health`.
- Debug endpoint `/api/debug/usage` that fires a one-line SDK query and returns the usage fields.
- Process-level shutdown drains every active `SessionLoop` cleanly.

## 7. Configuration cheat sheet

| Setting | Where | Default | Notes |
|---|---|---|---|
| Port | `chat_server.py` | `8225` | `HOST = "0.0.0.0"` |
| Model | `LLM_MODEL` env | `MiniMaxAI/MiniMax-M3` | Anthropic-compatible endpoint |
| API key | `LLM_API_KEY` env | hardcoded JWT in source | Set before deploy |
| Base URL | `LLM_BASE_URL` env | `http://localhost:8083/anthropic` | Proxied to actual Claude API |
| TTS voice | on-disk `.onnx` | `en_US-ryan-medium.onnx` then `lessac` | First match wins |
| Auth password | literal | `MS@1011` | `/api/auth/verify` |
| Session idle timeout | `_SESSION_IDLE_TIMEOUT` | 30 min | Hard-coded constant |
| SSE replay buffer | `maxlen=2000` | per-session | ~4MB at typical text_delta size |
| TTS cache size | `_TTS_CACHE_MAX_SIZE` | 300 | OrderedDict LRU |
| Heartbeat interval | `asyncio.wait_for(timeout=15)` | 15 s | No `id:` line on heartbeats |
| Context usage poll | `asyncio.sleep(10)` | 10 s | Plus per-turn snapshot |

## 8. Running it

```bash
# backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python chat_server.py            # listens on 0.0.0.0:8225

# frontend (dev with HMR)
cd FE && npm install && npm run dev   # Vite proxies /api to :8225

# frontend (production build — FastAPI will serve dist/)
cd FE && npm run build

# full boot with tunnel
./start_webclaude.sh             # python chat_server.py & + cloudflared
./restart_server.sh              # kills port 8225 and restarts
./stop_webclaude.sh
```

Cloudflared config lives at `~/.cloudflared/webclaude/config.yml` and is referenced by `start_webclaude.sh`.

## 9. Known gotchas (all worth knowing)

1. **Skills must not be `[]` or `"all"`** — both hang the SDK. Server coerces `[]` → `None`.
2. **`allowed_tools` / `disallowed_tools` are advisory** in this SDK version. Server enforces read-only in `can_use_tool` instead.
3. **Settings lock on first message.** Changing `setting_sources` / `skills` / `permission_mode` later in the same session is silently ignored for the locked fields. `permission_mode` is the exception — it can flip live because `can_use_tool` reads it per call.
4. **Image data round-trips.** FE sends `{data, media_type}` (base64); server wraps it in the SDK `image` block shape; JSONL reader reverses the wrap on reload to preserve thumbnails.
5. **`Stop hook feedback:` and `[structured-output-enforce]`** are filtered out of history reads — they're internal agent bookkeeping, not user-facing messages.
6. **DELETE session endpoints are no-ops** — the SDK JSONL format does not support deletion. Hiding a session = local UI state only.
7. **Session ID must be a UUID** — `/api/sessions/{sid}/...` returns 400 on anything else. The server validates at the trust boundary.
8. **Heartbeats never carry `id:`** — preserves `lastEventId` so quiet streams don't lose their replay cursor.
9. **`maxlen=2000` replay buffer** assumes typical text_delta payloads. A run with very large bash output can blow past 4MB/session; the `/messages` catch-up API covers any gap and the reducer dedupes.
10. **`_piper_voice` global is process-wide** — synthesis blocks the asyncio loop if the executor is exhausted. Max workers capped at 4.

## 10. Where to look next

- **`CLAUDE_AGENT_SDK_MIGRATION.md`** — definitive findings from the SDK migration. Read this before touching any SDK-related code.
- **`test_01_basic_stream.py` … `test_08_multi_turn.py`** — SDK smoke tests that mirror the streaming architecture.
- **`FE_AGENT_PROMPT.md`** — guidance for any agent that's about to modify the frontend.
- **`docs/{fe-agent-prompts, superpowers}/`** — design notes and process docs.
- **`schemas.py`** — Pydantic DTOs shared between routes.