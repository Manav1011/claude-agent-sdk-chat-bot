# Streaming-Input Mode Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This plan omits git operations — implement in current context without commits or branches.

**Goal:** Replace per-request streaming with per-session background task architecture, fixing Bugs 1–7 along the way.

**Architecture:** One `SessionLoop` class per session_id owns the `ClaudeSDKClient` and an `asyncio.Queue` of incoming messages. Multiple SSE subscriber queues fan out events. New endpoints `POST /sessions/{id}/messages`, `GET /sessions/{id}/events`, and `POST /sessions/{id}/interrupt` supersede the single-request `/api/chat` pattern. Old code paths coexist until deprecation.

**Tech Stack:** FastAPI + asyncio (backend), React 18 + SSE (frontend), ClaudeSDKClient (already in use)

---

## Global Constraints

- Python 3.11+, asyncio native
- Existing `ClaudeSDKClient` interface unchanged (query, receive_response, disconnect, interrupt)
- FE uses React 18, no new routing library
- Existing SQLite projects DB unchanged
- Max 5-minute permission timeout unchanged (per Bug 5f spec)

---

## Phase 1: Backend Foundation — SessionLoop + Subscriber Fan-out

**Goal:** Build the core machinery. Do not touch `/api/chat` yet.

### Files

- **Create:** `chat_server.py` — add `SessionLoop` class and session registry after line 154 (after `_WORKSPACE_CLIENTS` / `_cache_lock` definitions)
- **Modify:** `chat_server.py` — add two new route handlers after existing endpoints (approx. line 1200+)

### Skeleton

```python
# chat_server.py ~line 156 (after _cache_lock)
_SESSION_REGISTRY: dict[str, "SessionLoop"] = {}
_registry_lock = asyncio.Lock()

class SessionLoop:
    """Owns one ClaudeSDKClient, one incoming message queue, N subscriber queues."""

    def __init__(self, workspace: str, session_id: str):
        self.workspace = workspace
        self.session_id = session_id
        self._client: ClaudeSDKClient | None = None
        self._incoming: asyncio.Queue[UserMessage] = asyncio.Queue()
        self._subscribers: set[asyncio.Queue] = set()
        self._running = False

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._loop_body())

    async def _loop_body(self):
        # ponytail: subprocess errors reset client; next message rebuilds it.
        while self._running:
            msg = await self._incoming.get()
            try:
                if self._client is None:
                    self._client = await self._build_client()
                await self._client.query(self._make_generator(msg))
                async for event in self._client.receive_response():
                    await self._broadcast(event)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                await self._broadcast({"type": "error", "message": str(e), "session_id": self.session_id})
                # Drop broken client so the next message reconnects cleanly.
                if self._client is not None:
                    try:
                        await self._client.disconnect()
                    except Exception:
                        pass
                    self._client = None

    async def _build_client(self) -> "ClaudeSDKClient":
        opts = _build_options(
            workspace=self.workspace,
            session_id=self.session_id,
            resume=False,
            can_use_tool=self._make_can_use_tool(),
        )
        client = ClaudeSDKClient(options=opts)
        await client.connect()
        return client

    def _make_can_use_tool(self):
        # Per-session callback so permission events broadcast only to this session's subscribers.
        loop_ref = self
        async def can_use_tool(tool_name, tool_input, context):
            request_id = context.tool_use_id or f"perm_{uuid.uuid4().hex[:8]}"
            fut: asyncio.Future = asyncio.Future()
            _permission_futures[(self.session_id, request_id)] = fut
            meta = {
                "type": "permission_request",
                "request_id": request_id,
                "session_id": self.session_id,
                "tool_name": tool_name,
                "tool_input": tool_input,
                "tool_use_id": context.tool_use_id,
                "title": context.title,
                "description": context.description,
                "suggestions": [s.to_dict() for s in (context.suggestions or [])],
            }
            await loop_ref._broadcast(meta)
            try:
                result = await asyncio.wait_for(fut, timeout=300)
            except asyncio.TimeoutError:
                result = {"decision": "deny", "message": "Permission request timed out"}
            finally:
                _permission_futures.pop((self.session_id, request_id), None)
            await loop_ref._broadcast({"type": "permission_resolved", "request_id": request_id, "decision": result["decision"], "session_id": self.session_id})
            decision = result["decision"]
            if decision == "allow":
                if tool_name == "AskUserQuestion" and result.get("answers") is not None:
                    return PermissionResultAllow(updated_input={
                        "questions": tool_input.get("questions", []),
                        "answers": result["answers"],
                    })
                updated = result.get("updated_input")
                return PermissionResultAllow(updated_input=updated if updated is not None else tool_input)
            return PermissionResultDeny(message=result.get("message", "User denied"))
        return can_use_tool

    async def _broadcast(self, event: dict):
        for sub in list(self._subscribers):
            try:
                sub.put_nowait(event)
            except asyncio.QueueFull:
                # ponytail: drop slow subscriber; they can re-fetch via /sessions/{id}/messages history.
                pass

    def _make_generator(self, msg: "UserMessage"):
        # SDK requires {type:"user", message:{role,content}, parent_tool_use_id:None}
        async def gen():
            content = msg.content
            if msg.images:
                blocks = [{"type": "text", "text": content}]
                for img in msg.images:
                    blocks.append({"type": "image", "source": {"type": "base64", "media_type": img["media_type"], "data": img["data"]}})
                content = blocks
            yield {"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None}
        return gen()

    async def enqueue(self, msg: UserMessage):
        await self._incoming.put(msg)

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.discard(q)

    async def interrupt(self):
        if self._client:
            await self._client.interrupt()

    async def shutdown(self):
        self._running = False
        if self._client:
            await self._client.disconnect()
            self._client = None

async def get_or_create_loop(workspace: str, session_id: str) -> SessionLoop:
    key = session_id
    async with _registry_lock:
        if key not in _SESSION_REGISTRY:
            loop = SessionLoop(workspace, session_id)
            _SESSION_REGISTRY[key] = loop
            await loop.start()
        return _SESSION_REGISTRY[key]
```

### New Endpoints

```python
# chat_server.py — append after existing routes. Uses @app.post (not @router.post)
@app.post("/api/sessions/{session_id}/messages")
async def post_message(session_id: str, body: UserMessage, workspace: str = Query(...)):
    loop = await get_or_create_loop(workspace, session_id)
    await loop.enqueue(body)
    return {"status": "queued"}

@app.get("/api/sessions/{session_id}/events")
async def events(session_id: str, workspace: str = Query(...)):
    loop = await get_or_create_loop(workspace, session_id)
    q = loop.subscribe()
    try:
        async def stream():
            while True:
                # 15s heartbeat kicks in only when no real events are flowing (Phase 5)
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type':'heartbeat'})}\n\n"
        return StreamingResponse(stream(), media_type="text/event-stream")
    finally:
        loop.unsubscribe(q)

@app.post("/api/sessions/{session_id}/interrupt")
async def interrupt_session(session_id: str, workspace: str = Query(...)):
    loop = _SESSION_REGISTRY.get(session_id)
    if loop:
        await loop.interrupt()
    return {"status": "interrupted"}
```

### Idle timeout

`SessionLoop.shutdown()` is wired into a per-loop timer reset by every `_broadcast` and `enqueue` call. After 30 minutes of zero traffic (no subscribers, no queue items), the loop calls `client.disconnect()` and removes itself from `_SESSION_REGISTRY`. Configurable constant at module level.

- **Phase 1a:** `POST http://localhost:8000/api/sessions/test-123/messages?workspace=default` with `{"content": "hello"}` → returns `{"status":"queued"}` immediately.
- **Phase 1b:** `GET http://localhost:8000/api/sessions/test-123/events?workspace=default` (long-lived) + then POST a message → SSE stream receives events. Kill GET, POST again → new GET gets fresh events.
- **Phase 1c:** Two simultaneous GETs to `/events` for same session → both receive same events (subscriber fan-out confirmed).

**Bugs closed:** None (infrastructure only).

---

## Phase 2: Cache Eviction + interrupt() — Fix Bugs 1, 2, 5a

**Goal:** Stop the "Session ID is already in use" cascade and wire pause button to actually stop the agent.

### Files

- **Modify:** `chat_server.py` lines 902–921 (response_reader), lines 1078–1102 (event_stream finally block), lines 152–154 (_WORKSPACE_CLIENTS), line 857 (permission wait)

### Changes

**2a. Add `POST /sessions/{session_id}/interrupt` endpoint**

```python
@router.post("/sessions/{session_id}/interrupt")
async def interrupt_session(session_id: str, workspace: str = Query(...)):
    loop = await get_or_create_loop(workspace, session_id)
    await loop.interrupt()
    return {"status": "interrupted"}
```

**2b. Fix event_stream() finally block to call interrupt (per-request path)**

```python
# chat_server.py lines 1078–1102 — replace the finally block:
finally:
    reader_task.cancel()
    try:
        await reader_task
    except asyncio.CancelledError:
        pass
    # ponytail: disconnect the cached client so it's not reused in bad state
    # This closes Bug 1's cache leak
    if client:
        try:
            await client.disconnect()
        except Exception:
            pass
    # Evict from cache — ponytail: avoid the race; a new loop will be created
    async with _cache_lock:
        _WORKSPACE_CLIENTS.pop(cache_key, None)
```

**2c. Per-session lock for the old `/api/chat` path (interim, superseded by Phase 1)**

A simple `_session_locks: dict[str, asyncio.Lock]` plus `get_or_create_lock(session_id)`. Wrap the read-and-query sequence so concurrent requests for the same session_id serialize but different sessions don't block each other:

```python
# chat_server.py — add after _WORKSPACE_CLIENTS:
_session_locks: dict[str, asyncio.Lock] = {}

async def _session_lock(sid: str) -> asyncio.Lock:
    async with _cache_lock:
        lk = _session_locks.get(sid)
        if lk is None:
            lk = asyncio.Lock()
            _session_locks[sid] = lk
        return lk

# In response_reader, around line 913:
session_lk = await _session_lock(session_id)
async with session_lk:
    # existing read+use from _WORKSPACE_CLIENTS
    ...
```

This is interim: once Phase 1's `_SESSION_REGISTRY` lands, `/api/chat` redirects there too, and the global cache disappears.

**2d. Wire interrupt into permission wait (Bug 5a — tokens burned on SSE abort)**

```python
# chat_server.py ~line 857 — add interrupt on CancelledError
try:
    result = await asyncio.wait_for(future, timeout=300)
except asyncio.CancelledError:
    # ponytail: interrupt the client when permission request is cancelled by SSE abort
    if client:
        await client.interrupt()
    raise
```

### Verification

- **Bug 1 (cache eviction):** POST to `/api/chat` twice in rapid succession → second request does NOT get "Session ID already in use". Client is evicted after first request.
- **Bug 1 (race):** Two concurrent POSTs to `/api/chat` with same session_id → only one `client.query()` call happens; the other waits for the lock.
- **Bug 2 (pause stops agent):** Call `POST /api/sessions/{id}/interrupt` mid-stream → agent stops mid-token, no more SSE events. Tokens stopped.
- **Bug 5a (permission on abort):** Abort SSE during a pending permission → `client.interrupt()` fires, claude subprocess is told to stop.

**Bugs closed:** Bug 1 (both compounds), Bug 2, Bug 5a.

---

## Phase 3: Frontend Migration — ChatContext + New Endpoints

**Goal:** Replace per-request SSE with long-lived SSE per active tab. Remove the `isStreaming` guard.

### Files

- **Modify:** `FE/src/utils/api.js` — add `createSessionEventsource(session_id, workspace)` and `sendSessionMessage(session_id, workspace, content)` functions
- **Modify:** `FE/src/ChatContext.jsx` — refactor `sendMessage` to POST to new endpoint; replace `activeStreams` ref with a `sessionsRef: Map<session_id, {es: EventSource, abortCtrl: AbortController}>`; remove line 745 guard; rewrite `stopStream` to call `POST /sessions/{id}/interrupt`
- **Modify:** `FE/src/ChatInput.jsx` lines 250–260 — pause button `onClick` already calls `stopStream`, no FE change needed if `stopStream` is correctly wired

### Key Changes

**api.js additions:**

```javascript
// FE/src/utils/api.js
export function createSessionEventsource(sessionId, workspace) {
  const es = new EventSource(`/api/sessions/${sessionId}/events?workspace=${encodeURIComponent(workspace)}`);
  return es;
}

export function sendSessionMessage(sessionId, workspace, content, images = []) {
  // Returns a promise that resolves when the message is queued (not when done)
  return fetch(`/api/sessions/${sessionId}/messages?workspace=${encodeURIComponent(workspace)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, images }),
  }).then(r => r.json());
}
```

**ChatContext.jsx — `sendMessage` refactor (~line 700–760):**

```javascript
// Replace the isStreaming guard (line 745) and per-request fetch:
// OLD: if (activeStreams[sessionThreadId]?.isStreaming) return;
// NEW: allow concurrent sends; queue if loop is busy (Phase 3 handles this)
const session = sessionsRef.current.get(sessionThreadId) ?? {};
// Always create SSE if not present
if (!session.es || session.es.readyState === EventSource.CLOSED) {
  session.es = createSessionEventsource(sessionThreadId, currentWorkspace);
  session.es.onmessage = (e) => handleServerSentEvent(sessionThreadId, e);
  session.abortCtrl = new AbortController();
  sessionsRef.current.set(sessionThreadId, session);
}
await sendSessionMessage(sessionThreadId, currentWorkspace, message, images);
```

**ChatContext.jsx — `stopStream` refactor (~line 1072–1085):**

```javascript
// OLD: abortCtrl.abort() — only stops FE fetch reader
// NEW: call interrupt endpoint
async function stopStream(sessionId) {
  const session = sessionsRef.current.get(sessionId);
  if (session?.abortCtrl) session.abortCtrl.abort();
  await fetch(`/api/sessions/${sessionId}/interrupt?workspace=${currentWorkspace}`, { method: "POST" });
}
```

### Verification

- **Concurrent sends:** While agent is streaming, type and send a new message → new message is queued, agent continues previous + handles new in order. Line 745 guard is gone.
- **Pause button:** Click pause → `POST /interrupt` fires → agent stops mid-stream.
- **Tab switch:** Open tab A (session 1), tab B (session 2) → each has its own SSE connection. Tab A's stream does not affect tab B.
- **Reconnect:** Close and reopen tab → new SSE connects, can send new messages on that session.

**Bugs closed:** Bug 3 (concurrent sends while streaming), Bug 2 (pause button actually stops agent).

---

## Phase 4: Permission Fixes — Bugs 5b, 5c, 5d, 5e, 5f

**Goal:** Fix all five permission sub-bugs. Add `permission_resolved` SSE event. Wire periodic polling. Normalize answer keys.

### Files

- **Modify:** `chat_server.py` — add `permission_resolved` event emission in the auto-deny path (lines 1090–1096), fix global `_permission_futures` keying to include session_id
- **Modify:** `FE/src/ChatContext.jsx` — add `refreshPendingPermissions` call on a 10s interval, add handler for `permission_resolved` SSE event, update `pendingPermissions` cleanup
- **Modify:** `FE/src/PermissionPrompt.jsx` lines 84–85 — fix answer-key normalization

### Changes

**4a. Global permission futures keyed by session_id (Bug 5e)**

```python
# chat_server.py line 57 — change from:
_permission_futures: dict[str, asyncio.Future]
# to:
_permission_futures: dict[tuple[str, str], asyncio.Future]  # (session_id, request_id)
```

Update all call sites that read/write `_permission_futures` to use `(session_id, request_id)` as key.

**4b. Emit permission_resolved on auto-deny (Bug 5b, 5f)**

```python
# chat_server.py ~line 1090 — in the finally block of event_stream:
# After auto-denying dangling permissions, emit permission_resolved to each affected subscriber:
for (sess_id, req_id), future in list(_permission_futures.items()):
    if not future.done():
        decision = {"decision": "deny", "message": "Permission request timed out"}
        future.set_result(decision)
        # ponytail: broadcast to all subscribers for this session
        if sess_id in _SESSION_REGISTRY:
            loop = _SESSION_REGISTRY[sess_id]
            for sub in loop._subscribers:
                await sub.put({"type": "permission_resolved", "request_id": req_id, "decision": decision})
```

**4c. Answer-key normalization fix (Bug 5d)**

```javascript
// PermissionPrompt.jsx lines 84-85 — keep q.question priority (SDK requires answer key == question text exactly):
const answerKey = (q.question || '').trim() || `__q_${qIdx}__`;
// ponytail: empty/whitespace question text is a malformed tool call; use a sentinel so we
// can detect it. If the SDK rejects the answer, that surfaces as a clear error rather than
// silent loss.
```

The real fix is upstream: the FE should warn (or refuse to submit) when a question has no `question` text — only `header`. Today's code already passes `q.question` first, so most cases work; the fix just handles the edge case explicitly.

**4d. SSE-error-driven permission polling in FE (Bug 5c)**

Don't poll on a timer — poll only when the SSE connection has errors. Otherwise SSE delivers permission events in real time and polling just creates duplicate state.

```javascript
// ChatContext.jsx — poll only when SSE has been unhealthy for >5s
useEffect(() => {
  let timer = null;
  const armTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => refreshPendingPermissions(), 5000);
  };
  // Call armTimer() from EventSource onerror; clear timer on onopen.
  return () => timer && clearTimeout(timer);
}, [refreshPendingPermissions]);
```

In `createSessionEventsource` (api.js), wire `es.onopen = () => clearTimeout(pollTimer)` and `es.onerror = () => armTimer()`. One-shot poll at 5s after first error, not continuous.

**4e. Handle permission_resolved in FE (Bug 5b)**

```javascript
// In handleServerSentEvent:
if (event.type === "permission_resolved") {
  setPendingPermissions(prev =>
    prev.filter(p => p.request_id !== event.request_id)
  );
}
```

### Verification

- **Bug 5b:** Disconnect SSE mid-permission → permission prompt disappears from UI within 10s (polling) with no frozen state.
- **Bug 5c:** Reload page mid-permission → permission prompt reappears within 10s.
- **Bug 5d:** AskUserQuestion with only `header` field → answer is correctly routed to agent.
- **Bug 5e:** Two sessions, permission pending on session A → session B's UI does not show session A's permission prompt.
- **Bug 5f:** 5-minute timeout fires → `permission_resolved` event received by FE, prompt removed cleanly.

**Bugs closed:** Bugs 5b, 5c, 5d, 5e, 5f.

---

## Phase 5: SSE Heartbeat + Reconnect Logic (Bug 6)

**Goal:** Detect dead connections faster. Add heartbeat pings. Support FE auto-reconnect.

### Files

- **Modify:** `chat_server.py` — add periodic heartbeat write in `events` endpoint's stream function
- **Modify:** `FE/src/utils/api.js` — add `reconnectSession()` helper with exponential backoff
- **Modify:** `FE/src/ChatContext.jsx` — wire auto-reconnect on `EventSource.onerror`

### Changes

**BE heartbeat (every 15s):**

```python
# In events() stream generator:
async def stream():
    while True:
        try:
            event = await asyncio.wait_for(q.get(), timeout=15)
            yield f"data: {json.dumps(event)}\n\n"
        except asyncio.TimeoutError:
            yield f"data: {{\"type\": \"heartbeat\"}}\n\n"
```

**FE reconnect:**

```javascript
// api.js
export function reconnectSession(sessionId, workspace, onEvents, maxRetries = 5) {
  let attempt = 0;
  function connect() {
    const es = createSessionEventsource(sessionId, workspace);
    es.onmessage = onEvents;
    es.onerror = () => {
      if (attempt < maxRetries) {
        attempt++;
        setTimeout(connect, Math.min(1000 * 2 ** attempt, 30000));
      }
    };
    return es;
  }
  return connect();
}
```

### Verification

- **Heartbeat:** Monitor SSE with `curl` — every 15s a `{"type":"heartbeat"}` event appears with no other activity.
- **Dead connection:** Kill BE process, wait 20s, restart BE → FE reconnects automatically within ~2s (first backoff bucket). New SSE stream resumes.
- **Bug 6 closed.**

**Bugs closed:** Bug 6.

---

## Phase 6: Image Upload — Evaluate Inline vs Read-Tool

**Goal:** Decide based on actual screenshot sizes; lazy implementation first.

### Files

- **Modify:** `chat_server.py` — `_make_generator` in `SessionLoop` to accept `images: list[dict]` and emit multi-block content
- **Modify:** `FE/src/ChatContext.jsx` — pass images array in `sendSessionMessage`
- **Create:** small script to sample 10 uploaded images and report their base64 sizes

### Decision Process

1. Run a sampling script: for 10 recent uploads in `/tmp/uploads/`, report `len(base64-encoded)`.
2. Compare against Claude 3.5 Sonnet context window cost model: ~$3/million tokens for Haiku.
3. If median screenshot is <50KB base64 (~50K tokens ≈ $0.00015), inline is cheaper than an extra `Read` round-trip (~200+ tokens overhead).
4. If screenshots are typically 500KB+ (common for retina screenshots), inline bloats input tokens significantly — stick with Read tool workaround.
5. Document the decision in the plan.

### Implementation (inline path, if data supports it)

```python
# In SessionLoop._make_generator — replace gen() with:
async def gen():
    blocks = [{"type": "text", "text": msg.content}]
    for img in (msg.images or []):
        blocks.append({"type": "image", "source": {"type": "base64", "media_type": img["media_type"], "data": img["data"]}})
    yield {"type": "user", "content": blocks}
```

**FE sends images:**

```javascript
// sendSessionMessage — include images array (already storing base64 in FE state):
body: JSON.stringify({ content: message, images: attachedImages.map(img => ({ data: img.base64, media_type: img.type })) })
```

### Verification

- **Inline path:** Upload a screenshot → agent sees it in first turn, no extra `Read` tool call.
- **Read-tool path:** Upload a screenshot → agent uses `Read` tool to load it, one extra round-trip. Documented and working.

**Bugs closed:** Bug 4 (addressed — inline or documented tradeoff).

---

## Phase 7: Bug 7 — `updated_input` Validation

**Goal:** Warn when FE omits `updated_input` for tools that need it.

### Files

- **Modify:** `chat_server.py` — add validation in `can_use_tool` callback (~line 873–874, where `updated_input` is read)

### Changes

```python
# chat_server.py — inside can_use_tool, just before returning PermissionResultAllow:
TOOLS_REQUIRING_INPUT = {"Edit", "Bash", "Write", "NotebookEdit"}

updated = result.get("updated_input")
if tool_name not in {"AskUserQuestion"} and tool_name in TOOLS_REQUIRING_INPUT and updated is None:
    print(f"[WARN] {tool_name} called without updated_input; FE may have discarded user edits")
return PermissionResultAllow(updated_input=updated if updated is not None else tool_input)
```

### Verification

- Call a tool (e.g., Edit) without sending `updated_input` in the FE → backend log shows warning with tool name and session_id. No crash, no UX change.

**Bugs closed:** Bug 7.

---

## Non-Goals

- No migration away from SQLite for projects DB
- No changes to structured-output schema (Result blocks, thinking, etc.)
- No new tools
- No changes to `/api/upload` endpoint or `FE/src/utils/upload.js`
- No multi-workspace support beyond what currently exists
- No authentication / session security changes (treat session_id as already opaque)

---

## Risks / Open Questions

1. **Idle timeout for SessionLoop?** When does a SessionLoop shut down if no messages arrive? Options: never (lazy-create forever), 30-minute timeout after last subscriber disconnects, explicit `DELETE /sessions/{id}`. Need user input before implementing.

2. **`/api/chat` deprecation?** Do we keep it as a thin wrapper indefinitely for backward compatibility, deprecate it with a warning, or remove it entirely after FE migration? Recommend keeping as a thin wrapper forever (YAGNI — never know if something else uses it).

3. **FE auto-reconnect on SSE drop?** Phase 5 implements it with exponential backoff. If user prefers manual reconnect (less surprising on network blips), skip Phase 5's reconnect logic and only add heartbeats.

4. **What idle timeout for SessionLoop?** See #1. Also: does the user want sessions to survive a BE restart? If so, session state needs persistence, which is out of scope for this plan.

5. **`updated_input` validation level?** Phase 7 adds a warning log. Should it be a hard error (reject the tool call)? A soft warning is lower risk — some legitimate tools work fine without it.

6. **Image upload decision?** Phase 6 requires data collection. The plan commits to running the sampling script and making a decision, not speculating now.

---

## Concrete First Tasks

After plan approval, execute in this order:

1. **Create `SessionLoop` class in `chat_server.py`** — add the class definition after line 154 (after `_cache_lock`). Implement `_loop_body`, `enqueue`, `subscribe`, `unsubscribe`, `interrupt`, `shutdown`. Do not connect it to any endpoint yet.

2. **Add `_registry_lock` and `_SESSION_REGISTRY`** — global dict after the cache definitions.

3. **Wire `get_or_create_loop()`** — lazy-create + start a loop when first requested.

4. **Add `POST /sessions/{session_id}/messages` + `GET /sessions/{session_id}/events`** — two new endpoints, tested with curl. Old `/api/chat` untouched.

5. **Test Phase 1 with a manual curl script** — POST a message, open SSE GET, observe events. Confirm two subscribers both receive events.

---

## Bug → Phase Map

| Bug | Phase | Verification |
|-----|-------|---------------|
| Bug 1 (cache leak + race) | Phase 2 | Two rapid POSTs to `/api/chat` → no "already in use". Concurrent POSTs → only one query call. |
| Bug 2 (pause button) | Phase 2 | `POST /interrupt` → agent stops mid-token. |
| Bug 3 (concurrent sends) | Phase 3 | Send while streaming → new message queued, agent responds in order. Line 745 gone. |
| Bug 4 (image upload) | Phase 6 | Run sampling script, decide inline vs Read-tool. |
| Bug 5a (permission on abort) | Phase 2 | Abort SSE mid-permission → `client.interrupt()` fires. |
| Bug 5b (permission desync) | Phase 4 | Disconnect SSE mid-permission → prompt disappears within 10s. |
| Bug 5c (orphaned permissions) | Phase 4 | Reload page mid-permission → prompt reappears. |
| Bug 5d (answer-key) | Phase 4 | AskUserQuestion with only `header` → answer routes correctly. |
| Bug 5e (global permission key) | Phase 4 | Session A permission → Session B UI does not show it. |
| Bug 5f (timeout silently kicks in) | Phase 4 | 5-min timeout → `permission_resolved` received, prompt removed cleanly. |
| Bug 6 (heartbeat) | Phase 5 | SSE inactive 15s → `{"type":"heartbeat"}` event. Dead BE → FE reconnects automatically. |
| Bug 7 (updated_input fallback) | Phase 7 | Tool call without `updated_input` → warning in backend log. |
