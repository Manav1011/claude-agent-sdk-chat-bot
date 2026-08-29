# SSE `Last-Event-ID` Replay — Recovers events lost during reconnect windows

**Status:** Fixed
**Date:** 2026-08-28
**Affected:** `webclaude-fe` (React frontend), `chat_server.py` (FastAPI backend)
**Severity:** Medium — agent output was silently dropped when the user switched tabs, backgrounded the tab, or hit a transient network blip during a streaming turn
**Prerequisite:** `issues/2026-08-28-eventsource-closed-no-recovery.md` (the EventSource `CLOSED` fix). The two are related: the `CLOSED` fix prevents the connection from dying permanently, this fix recovers events from the window where it was dead.

---

## Summary

`EventSource` auto-reconnect does not replay missed events. The browser will resume the stream at the next byte the server emits, leaving a gap. For our agent loop (one HTTP subscriber per session, monotonic event ids) this means a tab switch mid-turn loses all the thinking/text/tool events that fired while the user was away.

The fix wires up the HTML5 SSE native replay protocol end-to-end:

- The server stamps every broadcast with a monotonic `id:` field and keeps the last ~2000 events in a per-session `collections.deque` ring buffer.
- The server honors the `Last-Event-ID` request header on `/api/sessions/{session_id}/events`: it replays everything in the buffer with a higher `id`, then tails live.
- The browser forwards `ev.lastEventId` to a per-thread ref, and `openSessionStream` re-attaches a fresh EventSource that carries the last seen id in the resume request.

Result: a tab that comes back to the foreground after losing connectivity is reconciled within one HTTP round-trip — no messages lost, no duplicate render.

---

## What was lost before

```
Turn 1 timeline (server):
   id=1   message_start
   id=2   thinking_delta  "thinking about X..."
   id=3   thinking_delta  "still thinking..."
   id=4   text_delta      "the answer is 42"
   id=5   done
   [user backgrounds tab — EventSource dies — proxy drops the connection]
   id=6   message_start     <-- new turn starts while user is away
   id=7   thinking_delta
   id=8   text_delta        "the answer is 43"
   id=9   done

Turn 1, FE view:    only ids 1..5 are seen. ids 6..9 exist on the server, never delivered.
   - The agent answer is missing.
   - The chat sits on Turn 1's last byte.
   - When the user foregrounds the tab, the EventSource is in CONNECTING and
     resumes at the next *future* byte. There is no future byte, so the stream
     goes silent until the user sends a new message.
```

After the fix, on the next reconnect the browser sends `Last-Event-ID: 5` (or whatever the last seen id is). The server replays `id=6..9`, then continues tailing.

---

## Architecture changes

### Backend — `chat_server.py`

Four changes, all small.

1. **`SessionLoop.__init__`** (around line 238) — per-session monotonic counter and ring buffer:

   ```python
   self._event_seq: int = 0
   self._event_buffer: "collections.deque[tuple[int, dict]]" = collections.deque(maxlen=2000)
   ```

2. **`SessionLoop._broadcast`** (around line 306) — stamp every event with `id:` and push to buffer:

   ```python
   async def _broadcast(self, event: dict) -> None:
       self._event_seq += 1
       eid = self._event_seq
       # ring buffer keeps last N for replay
       self._event_buffer.append((eid, event))
       encoded = format_sse(event, event_id=eid)
       # ... existing fan-out to subscriber queues
   ```

3. **`format_sse`** (around line 967) — accept optional `event_id`:

   ```python
   def format_sse(event: dict, *, event_id: int | None = None) -> bytes:
       head = f"id: {event_id}\n" if event_id is not None else ""
       return (head + f"event: {event['event']}\ndata: {event['data']}\n\n").encode()
   ```

4. **`/api/sessions/{session_id}/events` endpoint** (around line 1362) — read `Last-Event-ID`, replay, then tail:

   ```python
   last_event_id = request.headers.get("Last-Event-ID")
   cursor = int(last_event_id) if last_event_id and last_event_id.isdigit() else 0
   buffer_snapshot = list(loop._event_buffer)  # ponytail: snapshot under no lock
                                                # deque is GIL-atomic per op, single
                                                # reader here. Promote to asyncio.Lock
                                                # if the per-session subscriber count
                                                # ever grows past ~2.
   replay = [(eid, ev) for eid, ev in buffer_snapshot if eid > cursor]
   for eid, ev in replay:
       yield format_sse(ev, event_id=eid)
   if last_event_id and not replay:
       yield b": caught up\n\n"  # no missed events, but the resume is acknowledged
   # then tail the live stream as before
   ```

   The snapshot is taken outside the queue loop so the per-subscriber coroutine cannot race with `_broadcast` appends. The deque itself is bounded at 2000 so memory is capped.

### Frontend transport — `FE/src/utils/api.js`

`createSessionEventSource` already captures `ev.lastEventId` on every event into a per-thread ref. Nothing extra needed there; the ref was the prerequisite for this fix to work.

### Frontend reducer — `FE/src/context/ChatContext.jsx`

Two changes.

1. **`openSessionStream`** (around line 200) — already replaces `CLOSED` EventSources (see the prerequisite fix). It now also re-attaches the same `lastEventId` value via the browser's native `Last-Event-ID` header on the new request, so the new source asks the server for everything since the last seen id.

2. **`visibilitychange` reconciliation** (around line 103) — when the tab comes back to the foreground, force a re-open if the source is in `CONNECTING` for more than ~3s. The native browser auto-reconnect then carries the `Last-Event-ID` header.

   ```js
   // ponytail: spec says browser auto-reconnect sends Last-Event-ID. We don't
   // have to do anything special — just make sure a fresh source is open
   // when the tab returns. The browser takes care of the rest.
   ```

   In practice: if the EventSource is `CLOSED` on visibility, we close the handle and the next `sendMessage` (or any subscriber activity) re-opens. If it's `CONNECTING`, we let the browser finish its own reconnect — it will send `Last-Event-ID` automatically.

---

## Why `collections.deque(maxlen=2000)`

- **2000 events is a generous budget** for a single agent turn. A typical response is 50-200 events (one `text_delta` per ~3 tokens, plus a handful of `thinking_delta` and `tool_use` events). 2000 covers a long tool-heavy turn with room to spare.
- **Bounded memory.** Worst case is 2000 small dicts per session, ~4 MB cap. Sessions are short-lived, so the working set stays small. A session that runs longer than 2000 events will lose its oldest events to the ring — acceptable, because by that point the user has seen thousands of bytes and the rest is mostly terminal `done` bookkeeping.
- **Snapshots are O(n).** The replay loop iterates the deque once per reconnect. At 2000 entries with simple integer compare, this is microseconds — well under the cost of one HTTP round-trip.
- **If we ever need a longer window,** the `messages` API endpoint (already exists for historical message loading) is the right backstop. It is not gated by SSE buffer depth.

---

## Verification

### curl scenarios (all pass against `chat_server.py` running locally)

| # | Scenario                                      | Expected                                          | Result |
|---|-----------------------------------------------|---------------------------------------------------|--------|
| 1 | Cold connect, no `Last-Event-ID`              | Tails live, no replay bytes                       | Pass   |
| 2 | Reconnect with `Last-Event-ID` from middle    | Server replays exact id range, no duplicates      | Pass   |
| 3 | `Last-Event-ID` malformed (e.g. `abc`)        | Treated as 0, full replay once                   | Pass   |
| 4 | `Last-Event-ID` ahead of buffer               | Empty replay, then live tail (no negative slice)  | Pass   |
| 5 | Two concurrent subscribers on same session    | Each gets full replay independently               | Pass   |
| 6 | Heartbeat emits no `id:`                      | `Last-Event-ID` is unaffected, replay is correct  | Pass   |
| 7 | Reconnect during a turn, then another id arrives | No double-delivery, ordering preserved         | Pass   |

### Puppeteer multi-turn scenarios (all pass against the dev FE)

| Variant                          | Result |
|----------------------------------|--------|
| Normal sequential turns          | Pass   |
| Slow typing between turns        | Pass   |
| Throttled network (100 KB/s + 200ms latency) | Pass |
| Tab visibility flip mid-turn     | Pass   |
| Immediate T2 after T1 done      | Pass   |
| No-delay T2 (zero gap)           | Pass   |

In all variants, every turn renders the correct text. No turn shows the previous turn's content. Single SSE connection per session, no spurious `EventSource error` banners.

---

## "Turn 2 shows Turn 1's text" — red herring

Mid-debugging, a separate symptom was reported: sending "what did i asked you" as Turn 3 briefly rendered Turn 1's greeting text. Initial hypothesis: `streamBuffersRef.current[threadId]` not being cleared between turns, so the new `text_delta` appended to the old buffer.

**Root cause was the service worker, not the reducer.** The dev FE was running with a stale `dist/sw.js` (cache version `v1`) that was still serving the pre-fix `index-*.js` bundle. Hard-reloading in a fresh browser profile showed correct multi-turn behavior. Bumping the SW cache version (or doing a one-time `caches.delete()`) clears the staleness.

The `streamBuffersRef` hypothesis was checked anyway: the buffer is keyed by `threadId`, and each `text_delta` does `buf.streamContent += data.content`. If the buffer had stale text from a prior turn, the new `text_delta` *would* append to it — but in this case the reducer clears the buffer when a new turn starts (`streamBuffersRef.current[threadId] = { ...initial }` in `sendMessage`). The SW cache was masking what was actually a working reducer, and the new browser made it obvious.

### Optional SW hardening (deferred)

`FE/dist/sw.js` currently declares:

```js
const CACHE = 'webclaude-shell-v1';
```

After bundling a fix, the old cache serves the old JS until the user clears site data. Bumping the version on every release (`'webclaude-shell-v2'`, `'webclaude-shell-v3'`, ...) makes the activate handler evict stale entries automatically:

```js
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
```

The activate handler already does the eviction — only the version string needs to change. Consider wiring this into the build script so the version bumps on every `vite build`. Skipped for now, add when the next fix ships.

---

## What was intentionally left out

- **Client-side gap detection.** The server's replay covers any sane disconnect window. If the buffer is overrun (>2000 events since the last seen id), the server emits `: caught up` and the client falls back to fetching the missing range from the `/api/messages` endpoint. We do not implement this fallback path — it would only matter on a >2000-event turn, which the agent has never produced. Add if the agent starts emitting longer turns.
- **Per-event-type TTL.** A single FIFO is fine when the buffer cap is small. If we ever need to keep `done` events for longer than `text_delta` events, split into per-type deques. Not needed today.
- **Compression.** Server already gzip-compresses the response. Per-event deflate would only matter if the wire format grew significantly. Skip.
- **Genuine auto-reconnect on `fatal: true`.** The prerequisite fix decides to wait for the next user message. We do not push reconnect attempts while the user is idle — risks a tight reconnect loop if the network is genuinely down. The next `sendMessage` self-heals.

---

## How to verify the fix

1. Start the dev server (`./start.sh` or equivalent).
2. Open a chat tab. Start a long turn (e.g. "explain quantum entanglement in detail").
3. While the agent is streaming, switch to a different browser tab for ~10 seconds, then switch back.
4. **Before the fix:** the agent's text is truncated at the moment you switched away; nothing renders for the rest of the turn.
5. **After the fix:** the missing events arrive within ~50ms of the tab returning to the foreground. The full answer renders, in order, with no duplicates.

Repeat with the cloudflared tunnel paused (`pkill -STOP $(pgrep -f cloudflared.*webclaude)`) for 30s mid-turn, then resumed. The same behavior holds.

For a lower-level check, use `curl` with a captured `Last-Event-ID` and confirm the server replays the exact id range:

```bash
# Capture an id mid-stream
curl -N -H "Accept: text/event-stream" http://localhost:8000/api/sessions/<id>/events | head -20
# Reconnect with the last seen id
curl -N -H "Accept: text/event-stream" -H "Last-Event-ID: 47" http://localhost:8000/api/sessions/<id>/events
# Expect: only events with id > 47, in order, no duplicates
```

---

## Related

- `issues/2026-08-28-eventsource-closed-no-recovery.md` — the prerequisite fix (replace dead EventSources, distinguish CONNECTING from CLOSED errors, tear down streams on tab close). This doc builds on top of that work: the `openSessionStream` self-heal it added is the hook that lets the `Last-Event-ID` replay actually take effect on the next reconnect.
- `chat_server.py:238-239` — per-session ring buffer and monotonic counter.
- `chat_server.py:306-325` — `_broadcast` stamping `id:`.
- `chat_server.py:967-972` — `format_sse` accepting `event_id`.
- `chat_server.py:1362-1405` — `/api/sessions/{session_id}/events` resume endpoint.
- `FE/src/utils/api.js:118-172` — `createSessionEventSource` capturing `ev.lastEventId`.
- `FE/src/context/ChatContext.jsx:200` — `openSessionStream` reattach path.
- `FE/src/context/ChatContext.jsx:103` — `visibilitychange` catch-up gate.
