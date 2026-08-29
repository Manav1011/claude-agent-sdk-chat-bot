# EventSource "Connection Dead" — Stream stops delivering after a tab close or switch

**Status:** Fixed
**Date:** 2026-08-28
**Affected:** `webclaude-fe` (the React frontend)
**Severity:** High — agent output is silently dropped until the user refreshes the page

---

## Summary

When a user closes or switches an open chat tab, and the long-lived `EventSource` for that thread experiences a connection drop (network blip, proxy timeout, cloudflared tunnel hiccup), the EventSource enters the `CLOSED` readyState. From that moment on, the browser will **not** attempt to reconnect, and the frontend stops receiving any server-sent events for that thread — even though the server is still emitting them.

The next time the user sends a message, the frontend re-uses the dead EventSource and so the new turn's events are also dropped. The user sees a red `Execution Error / EventSource error` banner and the agent's response never appears in the UI. The only recovery is a hard page refresh.

---

## User-Visible Symptoms

1. User has multiple chat tabs open (the tab switcher badge in the header shows `> 1`).
2. User sends a message in one tab. The agent starts processing server-side (visible in server logs).
3. Either:
   - The user closes a tab, **or**
   - The user switches to a different tab, **or**
   - A transient network blip occurs (cloudflared tunnel re-establish, Wi-Fi flap, proxy idle timeout, etc.)
4. The `EventSource` for the affected thread fires its `onerror` handler.
5. A red `Execution Error / EventSource error` message appears in the chat.
6. The agent continues processing on the server (logs confirm output), but **no events flow to the UI**.
7. The user types and sends another message. The new turn also produces server output, but the UI never shows it.
8. The only fix is a full page refresh (`F5` / reload).

A representative user screenshot shows:
- A red `Execution Error` card with body text `EventSource error`
- The orange "Agent is processing…" dots still animating below it
- The chat input becomes effectively a black hole: typed messages are accepted, but no AI response ever renders

---

## Architecture Recap

The frontend uses one long-lived `EventSource` per chat thread. The lifecycle is:

1. **Open** — when the user sends a message, `sendMessage` (in `ChatContext.jsx`) calls `openSessionStream(threadId, handler)`. If a stream for that thread already exists, it reuses it; otherwise it creates a new one via `createSessionEventSource` in `utils/api.js`.
2. **Subscribe** — the per-thread handler `_handleSessionEvent` is registered with the stream manager. The handler converts raw SSE events into React state updates (message appends, streaming text, tool calls, etc.).
3. **Reuse** — every subsequent `sendMessage` for the same thread finds the existing stream and swaps in a fresh handler closure.
4. **Close** — only `closeSessionStream` and `closeAllSessionStreams` actually call `EventSource.close()`. They are invoked from very few places (unmount, workspace switch). **`closeTab` did not call them.**

The `EventSource` is a thin browser wrapper over the SSE protocol. The browser is responsible for managing the underlying HTTP connection and its reconnect behavior. There are three `readyState` values:

| `readyState` | Value | Meaning                                                                             |
| ------------ | ----- | ----------------------------------------------------------------------------------- |
| `CONNECTING` | `0`   | Connection is not open yet, or browser is auto-reconnecting after a transient error |
| `OPEN`       | `1`   | Connection is up and events are flowing                                            |
| `CLOSED`     | `2`   | Connection is dead. The browser will **not** reconnect automatically                |

The browser's default auto-reconnect is bounded: after enough consecutive failures, the EventSource transitions to `CLOSED` and the connection is considered permanently dead. There is no further recovery on the browser side.

---

## Root Cause

Three issues, in order of impact:

### 1. `onError` could not distinguish transient from terminal errors

**File:** `FE/src/utils/api.js:139` (before the fix)

```js
const onError = () => emit({ event: 'error', data: { message: 'EventSource error' } });
```

Every browser `onerror` invocation emitted a plain `{event: 'error', data: {message: 'EventSource error'}}` to all subscribers. The handler in `ChatContext.jsx:1031` could not tell whether the connection was merely reconnecting (`CONNECTING`) or permanently dead (`CLOSED`). In both cases it called `setErrorMessage(...)` and returned.

The result: when the browser transitioned the EventSource to `CLOSED`, the frontend never knew. It just kept thinking the next event was a moment away.

### 2. `openSessionStream` reused a dead EventSource

**File:** `FE/src/context/ChatContext.jsx:200` (before the fix)

```js
const openSessionStream = useCallback((threadId, sessionEventHandler) => {
  if (!threadId) return null;
  const existing = sessionStreamRef.current[threadId];
  if (existing) {
    if (existing.unsubscribe) existing.unsubscribe();
    const unsub = existing.streamManager.subscribe(sessionEventHandler);
    sessionStreamRef.current[threadId] = { ...existing, unsubscribe: unsub };
    return existing.streamManager;
  }
  // ... create new EventSource
});
```

When the user sent a new message, this function looked up the per-thread stream handle. If found, it returned the existing `streamManager` and only swapped the subscription callback. There was **no check on `streamManager.es.readyState`**. A dead, `CLOSED` EventSource was happily handed back to the caller. The caller would then attach a new handler to a connection that will never deliver another byte.

This is what made the bug "sticky" — once the source died, every subsequent `sendMessage` in the same thread silently failed to recover.

### 3. `closeTab` did not tear down the per-tab stream

**File:** `FE/src/context/ChatContext.jsx:769` (before the fix)

The `closeTab` callback only mutated `openTabs` and (if the closed tab was active) called `selectSession` / `startNewChat`. It never invoked `closeSessionStream(threadIdToClose)`.

Consequence: when the user closed a tab that had an open stream, the EventSource continued to live on in `sessionStreamRef.current`. The browser kept the underlying HTTP connection alive. When that connection eventually died (network blip, tunnel timeout, etc.), the dead `onerror` would fire into a handler whose React state for that thread was no longer mounted. The error would still call `setErrorMessage` globally, leaking the error into whatever tab was now active.

The `selectSession` path (line 676) had a similar omission: it loaded historical messages for the new active thread but did not ensure a fresh EventSource was open for it. If the user switched to a thread that had no open stream yet, the next `sendMessage` for that thread would create one — but if the thread did have an open stream, the existing (potentially dead) one was reused.

---

## Why the server-side output looked healthy

The Python backend (`chat_server.py`) runs a per-thread `SessionLoop` coroutine. Each HTTP subscriber of `/api/sessions/<thread_id>/events` has its own `asyncio.Queue`. When the frontend EventSource drops, the queue fills up and the loop blocks on `put()`. If the queue is bounded and overflows, or if a heartbeat times out (`chat_server.py:1361`, 15s default), the server-side subscriber is closed and the loop continues emitting to whatever subscribers remain.

The frontend's browser-level EventSource going `CLOSED` is invisible to the server. The server keeps running, the loop keeps generating events, but the bytes have nowhere to go. From the user's perspective: server logs say the agent responded, but the UI shows nothing.

This is also why the bug is intermittent and not always reproducible — it depends on the precise timing of the connection drop relative to the server's heartbeat / queue depth.

---

## Fix

Three minimal changes, no new state, no new context, no new dependencies.

### 1. `FE/src/utils/api.js` — distinguish transient from terminal in `onError`

```js
// ponytail: EventSource fires onerror in three states. CONNECTING = browser
// is auto-reconnecting (transient, silent). OPEN = shouldn't fire onerror but
// if it does, the connection is alive. CLOSED = terminal, browser will not
// reconnect — emit a fatal flag so callers can recreate the source.
const onError = () => {
  if (es.readyState === EventSource.CONNECTING) return;
  const fatal = es.readyState === EventSource.CLOSED;
  emit({ event: 'error', data: { message: 'EventSource error', fatal } });
};
```

Effect: a `CONNECTING` `onerror` (the browser is retrying) is now silent — no spurious red banner. A `CLOSED` `onerror` (the connection is permanently dead) carries a `fatal: true` flag so downstream code can react.

### 2. `FE/src/context/ChatContext.jsx` `openSessionStream` — recreate dead sources

```js
const openSessionStream = useCallback((threadId, sessionEventHandler) => {
  if (!threadId) return null;
  const existing = sessionStreamRef.current[threadId];
  // ponytail: a CLOSED EventSource will never deliver events again. Detect and
  // replace it. Without this, a single network blip permanently breaks the
  // session — error fires, browser gives up, FE never sees new messages.
  if (existing && existing.streamManager?.es?.readyState === EventSource.CLOSED) {
    try { existing.unsubscribe(); existing.streamManager.close(); } catch (_) {}
    delete sessionStreamRef.current[threadId];
  } else if (existing) {
    if (existing.unsubscribe) existing.unsubscribe();
    const unsub = existing.streamManager.subscribe(sessionEventHandler);
    sessionStreamRef.current[threadId] = { ...existing, unsubscribe: unsub };
    return existing.streamManager;
  }
  const ws = getWorkspacePath();
  if (!ws) return null;
  const streamManager = createSessionEventSource({ threadId, workspace: ws });
  const unsubscribe = streamManager.subscribe(sessionEventHandler);
  sessionStreamRef.current[threadId] = { streamManager, unsubscribe };
  return streamManager;
}, [getWorkspacePath]);
```

Effect: every call to `openSessionStream` now self-heals. The next `sendMessage` (or any other caller) on a thread whose EventSource is `CLOSED` will get a brand-new source. The new connection re-attaches to the same backend `SessionLoop` via a fresh subscriber queue, and events for the new turn flow through.

### 3. `FE/src/context/ChatContext.jsx` `closeTab` — tear down the stream

```js
const closeTab = useCallback((threadIdToClose) => {
  // ponytail: tear down the EventSource for the closed tab so it can't fire
  // errors into a dead handler later. Without this, closing a streaming tab
  // leaks the source and triggers "EventSource error" on subsequent switches.
  closeSessionStream(threadIdToClose);
  setOpenTabs((prevTabs) => {
    // ... existing logic unchanged
  });
}, [closeSessionStream, currentThreadId, selectSession, startNewChat]);
```

Effect: closing a tab now actually closes its network connection. The browser reclaims the socket, the server's subscriber is closed, and `onerror` cannot fire into a stale handler.

---

## Why this is the right fix (not a workaround)

- **Root cause, not symptom.** The original symptom was "no messages appear." The actual cause is "the EventSource that delivers messages is dead and we keep using it." Patching only the handler (e.g., auto-clearing the error banner) would not bring messages back; patching only the `openSessionStream` would not stop the dead source from firing errors in the first place. All three changes are needed because all three problems exist in the code.
- **No new state.** The fix uses only `EventSource.readyState` (a browser API) and the existing `sessionStreamRef` map. No new `useRef`, no new context, no new prop drilling.
- **No new dependencies.** Everything is built into the DOM and React 18.
- **Idempotent.** Calling `closeSessionStream` on a thread that has no stream is a no-op. Re-entering the `CLOSED` branch in `openSessionStream` is the same as the cold-start path.
- **Backwards compatible.** A non-fatal error (transient reconnect) still emits the same shape as before, just with `fatal: false` (omitted). Existing callers in `_handleSessionEvent` that only check `event === 'error'` still work. The new `fatal: true` is opt-in for code that wants to react to it (we currently do not, but the door is open).

---

## What was intentionally left out

- **Auto-reconnect on `fatal: true` without a new user message.** Would require storing the handler closure in `sessionStreamRef` and re-invoking `openSessionStream` from inside `_handleSessionEvent`. Risks a reconnect loop if the network is genuinely down. Skipped because the user's actual flow is "send a new message, expect output" — the next `sendMessage` now self-heals. Add it if "wait passively for a response" becomes a common flow that breaks.
- **`selectSession` ensuring a fresh stream is open.** `selectSession` only loads historical messages. If the newly-active thread has no open stream, the next `sendMessage` will create one. If it has a dead stream, `openSessionStream` (with fix #2) will replace it. Pre-opening a stream in `selectSession` would waste a connection for tabs the user only opens to read history. Skipped.
- **Exponential backoff on `fatal: true` reconnects.** Same reasoning as the auto-reconnect point above.
- **Server-side backpressure / queue bounding.** The current unbounded per-subscriber queue can grow indefinitely if a frontend goes silent for a long time. A bounded queue with a "client is too slow, drop them" policy would prevent the server from holding megabytes of stale events for a dead client. Out of scope for this issue; the symptoms are client-side, and the server already has the `finally` at `chat_server.py:1362-1363` to clean up dropped subscribers.

---

## How to verify the fix

1. Open multiple chat tabs (need at least 2 to trigger the original "close a tab" repro).
2. Start a long-running agent turn in tab A (e.g. "explain X in detail").
3. While the agent is streaming, either:
   - Close tab A, or
   - Switch to tab B, or
   - Pause the cloudflared tunnel for ~30s (`pkill -STOP $(pgrep -f cloudflared.*webclaude)`), then resume it (`pkill -CONT ...`).
4. **Before the fix:** the chat shows a red `Execution Error / EventSource error` card, no more agent output, the next message also gets stuck, and only a page refresh recovers.
5. **After the fix:**
   - Closing a tab: no spurious error. The remaining tab continues to work.
   - Switching tabs: the new tab's historical messages load; any subsequent message there works.
   - A network blip: the `onerror` either stays silent (during `CONNECTING`) or emits once with `fatal: true`. The next `sendMessage` (on the same thread or any other) creates a fresh EventSource. No page refresh required.

The relevant file:line references after the fix:

- `FE/src/utils/api.js:139` — `onError` checks `readyState`
- `FE/src/context/ChatContext.jsx:200` — `openSessionStream` replaces `CLOSED` sources
- `FE/src/context/ChatContext.jsx:771` — `closeTab` calls `closeSessionStream`

---

## Related notes

- The browser's default EventSource reconnect uses a backoff that starts near 0 and grows. After several failures it gives up and the source becomes `CLOSED`. This is spec'd behavior, not a bug to "fix" by extending the timeout.
- The server's heartbeat (`chat_server.py:1361`, 15s default) is the right place to control idle-connection timeouts. The frontend's role is to detect a dead connection and recreate it, which is what this fix does.
- If the cloudflared tunnel is a frequent offender, consider increasing the tunnel's `--proxy-keepalive-connections` or whatever the equivalent flag is in your cloudflared version. Out of scope for the FE fix, but worth measuring.
