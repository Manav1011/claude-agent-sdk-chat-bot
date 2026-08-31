# Rebuild SDK Client on Settings Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user changes `setting_sources`, `skills`, or `permission_mode` in the FE settings modal, the BE tears down the active session's `ClaudeSDKClient` and rebuilds it with the new settings (preserving the JSONL conversation via `--resume`). The rebuilt client's `get_server_info()` is broadcast over the existing SSE as a fresh `commands_available` event, so the slash palette reflects the new settings immediately and the running agent matches what the UI shows.

**Architecture:** New BE method `SessionLoop.rebuild_with_settings()` that disconnects the current `_client` and calls the existing `_build_client()` with explicit overrides (the same path used for permission-mode respawn, just generalized). New `POST /api/sessions/{id}/settings` endpoint exposes it. FE adds a debounced `rebuildSessionSettings` action fired from the four settings setters, and a small "Reinitializing session…" indicator in the input. The per-turn `ensure_commands_broadcast` re-broadcast in `_loop_body` becomes the safety net (cache hit on every turn after the rebuild) — no change to its logic, just the inputs it reads.

**Tech Stack:** Python 3.12 (FastAPI, claude-agent-sdk), React 18, Vite 5, Tailwind 3. Existing patterns: SSE event broadcasting in `SessionLoop._broadcast`, reducer-based event handling in `ChatContext._handleSessionEvent`, async REST helpers in `FE/src/utils/api.js`.

## Global Constraints

- **Ponytail mode active** (level: full). Smallest correct diff. No speculative abstractions.
- **No new deps**. Reuse `ClientSDKClient.disconnect()` and `_build_client()`; reuse the existing `ensure_commands_broadcast()` for the post-rebuild broadcast.
- **No FE test framework** exists; verify FE changes via `npm run build` (must succeed) + a manual smoke checklist. Verify BE via curl against a running session.
- **Comment style**: every non-obvious line gets a `// ponytail: ...` or `# ponytail: ...` comment.
- **Rollback**: each task is its own commit. If a task fails review or breaks something, `git revert <hash>` cleanly undoes just that task.
- **Existing safety nets stay**: `_loop_body` per-turn `ensure_commands_broadcast` re-broadcast (cache hit, idempotent) and SSE-open broadcast (cache hit, idempotent) are unchanged. The new endpoint is the only new broadcast trigger.
- **Settings are rare**: a 2s SDK init is acceptable on a settings change. Show a "Reinitializing…" indicator; do not block the UI thread.

## File Structure

**Modified files:**
- `chat_server.py` — new `SessionLoop.rebuild_with_settings()` method; new `POST /api/sessions/{session_id}/settings` route.
- `FE/src/utils/api.js` — new `rebuildSessionSettings()` async helper.
- `FE/src/context/ChatContext.jsx` — new `rebuilding` state map (per threadId), new `rebuildSession` callback wired from the four settings setters, debounce logic, state clear on `commands_available` and on `result` event.
- `FE/src/components/Input/ChatInput.jsx` — small "Reinitializing session…" badge near the textarea when `rebuilding[currentThreadId]` is true.

**Not modified:**
- `FE/src/components/Modals/SettingsModal.jsx` — calls the existing `setSettingSources`/`setSkillsMode`/`setSkillsList`/`setPermissionMode` setters, which are now debounced+rebuilding. No UI change.
- `SessionLoop._loop_body` — the per-turn re-broadcast already uses `_locked_settings`; after `rebuild_with_settings` updates it, the existing path is correct. No code change.
- `SessionLoop.ensure_commands_broadcast` — unchanged. The new endpoint calls it after the rebuild, so the SSE gets the fresh list for the new scope.

---

## Task 1: Backend — `SessionLoop.rebuild_with_settings` method

**Files:**
- Modify: `chat_server.py` — add method after `ensure_commands_broadcast` (currently ends at line 339).

**Why:** The cleanest way to swap the SDK client on settings change is the same path we already use for permission-mode respawn (disconnect + `_build_client` with overrides). Generalizing it into a method lets the new endpoint and any future caller share one implementation.

- [ ] **Step 1: Add `rebuild_with_settings` to `SessionLoop`**

In `chat_server.py`, immediately after `ensure_commands_broadcast` ends (after the `if cmds:` block), add:

```python
    async def rebuild_with_settings(
        self,
        setting_sources: list | None,
        skills: list | Literal["all"] | None,
        permission_mode: str | None,
    ) -> None:
        # ponytail: same shape as the permission-mode respawn in _loop_body,
        # generalized for any setting change. _build_client with explicit
        # overrides bypasses _locked_settings so the new scope applies even
        # before the first message locks anything in. --resume (inside
        # _build_client) keeps the JSONL conversation continuous; the agent's
        # in-memory state is lost, but the next user message re-sees the
        # full history.
        #
        # Order matters: build the new client BEFORE disconnecting the old
        # one. If the new build fails, the old client is still in place and
        # the session stays usable. A failed disconnect with a half-built
        # replacement would brick the session until the next message retry.
        if setting_sources == []:
            setting_sources = None
        if skills == []:
            skills = None
        mode = permission_mode if permission_mode is not None else self._current_permission_mode
        new_client = await self._build_client(
            mode,
            setting_sources=setting_sources,
            skills=skills,
        )
        old_client = self._client
        self._client = new_client
        # Lock the new settings so the next message uses the same scope.
        # _loop_body's per-turn re-broadcast reads from _locked_settings,
        # so updating it here keeps the safety-net broadcast in sync.
        self._locked_settings = {
            "setting_sources": setting_sources,
            "skills": skills,
        }
        self._current_permission_mode = mode
        if old_client is not None:
            try:
                await old_client.disconnect()
            except Exception as e:
                print(f"[WARN] old client disconnect failed during rebuild: {e}")
        # Broadcast the fresh command list for the new scope. Cache hit
        # if another session in the same (workspace, scope) already paid
        # the SDK init cost; miss otherwise (~2s).
        await self.ensure_commands_broadcast(
            setting_sources=setting_sources,
            skills=skills,
        )
        print(
            f"[REBUILD] {self.session_id} setting_sources={setting_sources} "
            f"skills={skills} permission_mode={mode!r}"
        )
```

- [ ] **Step 2: Verify the file parses**

Run:
```bash
python -c "import ast; ast.parse(open('chat_server.py').read())"
```
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add chat_server.py
git commit -m "feat(be): SessionLoop.rebuild_with_settings — swap SDK client on settings change"
```

---

## Task 2: Backend — `POST /api/sessions/{session_id}/settings` endpoint

**Files:**
- Modify: `chat_server.py` — add new route near `post_session_message` (currently at line 1519).

**Why:** The FE needs an HTTP surface to trigger the rebuild. Reusing the existing `_UserMessage` model for the body keeps the field shape consistent with `POST /api/sessions/{id}/messages` — same names, same validation, same parsing.

- [ ] **Step 1: Add the route**

In `chat_server.py`, immediately after `post_session_message` ends (after the `return {"status": "queued", ...}` line), add:

```python
@app.post("/api/sessions/{session_id}/settings")
async def post_session_settings(
    session_id: str,
    body: _UserMessage,
    workspace: str = Query(...),
):
    # ponytail: same trust-boundary validation as post_session_message.
    # The body carries setting_sources/skills/permission_mode; content/images
    # are accepted but ignored — the request is configuration-only, not a
    # user turn. Reusing _UserMessage avoids a near-duplicate model.
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="session_id must be a UUID")
    print(
        f"[FE_OPTS] rebuild {session_id} setting_sources={body.setting_sources} "
        f"skills={body.skills} permission_mode={body.permission_mode}"
    )
    loop = await get_or_create_loop(workspace, session_id)
    try:
        await loop.rebuild_with_settings(
            setting_sources=body.setting_sources,
            skills=body.skills,
            permission_mode=body.permission_mode,
        )
    except Exception as e:
        # ponytail: rebuild is best-effort. If it fails, the loop is in
        # whatever state _build_client left it in (probably unchanged —
        # the old client is only swapped after a successful new build).
        # Surface the error to the FE so it can show a toast and clear
        # the "Reinitializing…" indicator; the session stays usable.
        print(f"[ERROR] rebuild failed for {session_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Rebuild failed: {e}")
    return {"status": "rebuilt", "session_id": session_id}
```

- [ ] **Step 2: Verify the file parses**

Run:
```bash
python -c "import ast; ast.parse(open('chat_server.py').read())"
```
Expected: no output, exit 0.

- [ ] **Step 3: Smoke-test the endpoint with curl (no rebuild expected; the call may take ~2s on cold cache)**

Start the server if not already running, then:
```bash
SID=$(python -c "import uuid; print(uuid.uuid4())")
curl -sS -X POST "http://localhost:8225/api/sessions/$SID/settings?workspace=." \
  -H "Content-Type: application/json" \
  -d '{"content":"","setting_sources":["user"],"skills":null,"permission_mode":null}'
```
Expected: `{"status":"rebuilt","session_id":"<sid>"}` (after ~2s on first call, < 200ms on subsequent calls with the same scope).

Also verify the bad-UUID path:
```bash
curl -sS -X POST "http://localhost:8225/api/sessions/not-a-uuid/settings?workspace=." \
  -H "Content-Type: application/json" \
  -d '{"content":"","setting_sources":["user"],"skills":null,"permission_mode":null}'
```
Expected: HTTP 400 with `{"detail":"session_id must be a UUID"}`.

- [ ] **Step 4: Commit**

```bash
git add chat_server.py
git commit -m "feat(be): POST /api/sessions/{id}/settings — apply new scope to live session"
```

---

## Task 3: Frontend — `rebuildSessionSettings` helper + ChatContext action

**Files:**
- Modify: `FE/src/utils/api.js` — add helper after `interruptSession` (line 124).
- Modify: `FE/src/context/ChatContext.jsx` — add `rebuilding` state, `rebuildSession` callback, and expose them in the context value.

**Why:** Centralizing the rebuild trigger in a single ChatContext action lets the four setters share debounce + in-flight + error handling. The api.js helper keeps the fetch shape consistent with `sendSessionMessage` and `interruptSession`.

- [ ] **Step 1: Add the api.js helper**

In `FE/src/utils/api.js`, immediately after `interruptSession`, add:

```js
export async function rebuildSessionSettings({ threadId, workspace, settingSources, skills, permissionMode, signal }) {
  const res = await fetch(`/api/sessions/${threadId}/settings?workspace=${encodeURIComponent(workspace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: '',  // unused; the body shape matches sendSessionMessage
      setting_sources: settingSources ?? null,
      skills: skills ?? null,
      permission_mode: permissionMode ?? null,
    }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to rebuild session (${res.status})`);
  }
  return res.json();
}
```

- [ ] **Step 2: Add the import in ChatContext**

In `FE/src/context/ChatContext.jsx`, add `rebuildSessionSettings` to the import from `../utils/api`. The import block currently is:

```js
import {
  fetchProjects,
  fetchWorkspace,
  createProject,
  deleteProjectApi,
  fetchProjectSessions,
  fetchSessionMessages,
  deleteSessionApi,
  fetchPendingPermissions,
  submitPermissionDecision,
  sendSessionMessage,
  interruptSession,
  createSessionEventSource,
} from '../utils/api';
```

Add `rebuildSessionSettings` after `interruptSession`.

- [ ] **Step 3: Add `rebuilding` state and ref-based debounce**

In `FE/src/context/ChatContext.jsx`, alongside the other settings state (around line 67-90), add:

```js
// ponytail: { [threadId]: boolean } — true while a rebuild POST is in flight
// for that session. The indicator in ChatInput reads `rebuilding[currentThreadId]`.
const [rebuilding, setRebuilding] = useState({});
// ponytail: per-thread debounce timer. Multiple rapid settings changes
// (e.g. toggling three scopes) collapse into one rebuild 400ms after the
// last change. Without this, each toggle pays a 2s SDK init.
const rebuildTimersRef = useRef({});
```

- [ ] **Step 4: Add the `rebuildSession` callback**

In `FE/src/context/ChatContext.jsx`, after the `closeSessionStream` callback (around line 264), add:

```js
const rebuildSession = useCallback((threadId, settings) => {
  if (!threadId) return;
  const ws = getWorkspacePath();
  if (!ws) return;
  // ponytail: clear any pending timer for this thread so the new change
  // resets the 400ms window. The previous scheduled call becomes a no-op
  // (we cancel its in-flight AbortController via the signal).
  const prev = rebuildTimersRef.current[threadId];
  if (prev) {
    clearTimeout(prev.timer);
    prev.controller.abort();
  }
  const controller = new AbortController();
  rebuildTimersRef.current[threadId] = { timer: null, controller };
  rebuildTimersRef.current[threadId].timer = setTimeout(async () => {
    setRebuilding((prev) => ({ ...prev, [threadId]: true }));
    try {
      await rebuildSessionSettings({
        threadId,
        workspace: ws,
        settingSources: settings.settingSources,
        skills: settings.skills,
        permissionMode: settings.permissionMode,
        signal: controller.signal,
      });
      // ponytail: don't clear `rebuilding` here — wait for the matching
      // commands_available (next step). On error, fall through to the
      // catch and clear so the indicator doesn't stick.
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('rebuildSession failed', e);
        setRebuilding((prev) => ({ ...prev, [threadId]: false }));
      }
    } finally {
      delete rebuildTimersRef.current[threadId];
    }
  }, 400);
}, [getWorkspacePath]);
```

- [ ] **Step 5: Clear `rebuilding` when a fresh `commands_available` lands for that thread**

Find the existing `commands_available` handler in `_handleSessionEvent` (around line 1120-1126):

```js
if (data.type === 'commands_available') {
  setCommands((prev) => ({ ...prev, [sessionThreadId]: data.commands || [] }));
  return;
}
```

Change it to:

```js
if (data.type === 'commands_available') {
  setCommands((prev) => ({ ...prev, [sessionThreadId]: data.commands || [] }));
  // ponytail: a fresh commands list is the BE's signal that the rebuild
  // (if any) is complete. Clear the indicator so the user can type.
  setRebuilding((prev) => (prev[sessionThreadId] ? { ...prev, [sessionThreadId]: false } : prev));
  return;
}
```

- [ ] **Step 6: Safety timeout — clear `rebuilding` after 6s if no `commands_available` arrives**

In the same `_handleSessionEvent` function, find a stable place to add a watcher. The simplest is a separate `useEffect` outside the handler. Add it just after the `rebuilding` state declaration:

```js
// ponytail: safety net. If the rebuild POST succeeds but the
// commands_available broadcast is lost (network blip, client crash),
// the indicator would stick forever. Clear it 6s after the POST resolved.
useEffect(() => {
  const stuck = Object.entries(rebuilding)
    .filter(([, v]) => v)
    .map(([tid]) => tid);
  if (stuck.length === 0) return;
  const t = setTimeout(() => {
    setRebuilding((prev) => {
      const next = { ...prev };
      stuck.forEach((tid) => { next[tid] = false; });
      return next;
    });
  }, 6000);
  return () => clearTimeout(t);
}, [rebuilding]);
```

- [ ] **Step 7: Expose `rebuilding` and `rebuildSession` in the context value**

In the context value object (around line 1407 onwards, the `value = {` block), add:

```js
    rebuilding,
    rebuildSession,
```

- [ ] **Step 8: Build to confirm no compile errors**

Run:
```bash
cd FE && npm run build
```
Expected: build succeeds; new hash in `dist/assets/index-*.js`.

- [ ] **Step 9: Commit**

```bash
git add FE/src/utils/api.js FE/src/context/ChatContext.jsx
git commit -m "feat(fe): rebuildSessionSettings helper + ChatContext action with debounce"
```

---

## Task 4: Frontend — wire the four settings setters to fire `rebuildSession`

**Files:**
- Modify: `FE/src/context/ChatContext.jsx` — update `setSettingSources`, `setSkillsMode`, `setSkillsList`, `setPermissionMode` in the context value (around lines 1458-1476).

**Why:** The settings modal calls these setters. Each must now also fire a debounced rebuild when an active session exists. No new UI in the modal — the rebuild is invisible to it.

- [ ] **Step 1: Update `setSettingSources`**

Find:

```js
    setSettingSources: (val) => {
      setSettingSources(val);
      if (!val) localStorage.removeItem('qa-setting-sources');
      else if (val.includes('user')) localStorage.setItem('qa-setting-sources', 'user');
      else if (val.includes('local')) localStorage.setItem('qa-setting-sources', 'local');
    },
```

Change to:

```js
    setSettingSources: (val) => {
      setSettingSourcesState(val);
      settingSourcesRef.current = val;
      if (!val) localStorage.removeItem('qa-setting-sources');
      else if (val.includes('user')) localStorage.setItem('qa-setting-sources', 'user');
      else if (val.includes('local')) localStorage.setItem('qa-setting-sources', 'local');
      // ponytail: fire a debounced rebuild for the active session only.
      // rebuildSession is a no-op when there is no currentThreadId.
      const skillsForRebuild = skillsMode === 'all' ? 'all' : skillsList;
      rebuildSession(currentThreadId, {
        settingSources: val,
        skills: skillsForRebuild,
        permissionMode,
      });
    },
```

- [ ] **Step 2: Update `setSkillsMode`**

Find:

```js
    setSkillsMode: (val) => {
      setSkillsMode(val);
      localStorage.setItem('qa-skills-mode', val);
    },
```

Change to:

```js
    setSkillsMode: (val) => {
      setSkillsMode(val);
      localStorage.setItem('qa-skills-mode', val);
      const skillsForRebuild = val === 'all' ? 'all' : skillsList;
      rebuildSession(currentThreadId, {
        settingSources: settingSourcesRef.current,
        skills: skillsForRebuild,
        permissionMode,
      });
    },
```

- [ ] **Step 3: Update `setSkillsList`**

Find:

```js
    setSkillsList: (val) => {
      setSkillsList(val);
      localStorage.setItem('qa-skills-list', JSON.stringify(val));
    },
```

Change to:

```js
    setSkillsList: (val) => {
      setSkillsList(val);
      localStorage.setItem('qa-skills-list', JSON.stringify(val));
      // ponytail: list changes only matter when skillsMode is 'custom';
      // for 'all'/'default'/'none' the SDK's value is fixed. We still
      // pass the list so the rebuild is correct when the user is editing
      // a custom list.
      const skillsForRebuild = skillsMode === 'all' ? 'all' : val;
      rebuildSession(currentThreadId, {
        settingSources: settingSourcesRef.current,
        skills: skillsForRebuild,
        permissionMode,
      });
    },
```

- [ ] **Step 4: Update `setPermissionMode`**

Find:

```js
    setPermissionMode: (val) => {
      setPermissionMode(val);
      if (val) localStorage.setItem('qa-permission-mode', val);
      else localStorage.removeItem('qa-permission-mode');
    },
```

Change to:

```js
    setPermissionMode: (val) => {
      setPermissionMode(val);
      if (val) localStorage.setItem('qa-permission-mode', val);
      else localStorage.removeItem('qa-permission-mode');
      const skillsForRebuild = skillsMode === 'all' ? 'all' : skillsList;
      rebuildSession(currentThreadId, {
        settingSources: settingSourcesRef.current,
        skills: skillsForRebuild,
        permissionMode: val,
      });
    },
```

- [ ] **Step 5: Rename the internal state setter to avoid the name collision**

In each of the four updates above, the original line `setSettingSources(val);` references the *setter* returned by `useState`. Now that the context value also exports a `setSettingSources` (a wrapper), the local `useState` setter is shadowed inside the wrapper's body. To fix the shadow, rename the local state setter at its declaration site (around line 67).

Find:

```js
  const [settingSources, setSettingSources] = useState(getInitialSettingSources);
```

Change to:

```js
  const [settingSources, setSettingSourcesState] = useState(getInitialSettingSources);
```

No other call sites of the local `setSettingSources` setter exist outside the four wrappers (verified — the only uses are the wrappers, and any future internal use can call `setSettingSourcesState` directly). The context value's `setSettingSources` is the public API; the internal `_State` suffix marks it private.

- [ ] **Step 6: Build to confirm no compile errors**

Run:
```bash
cd FE && npm run build
```
Expected: build succeeds; new hash in `dist/assets/index-*.js`.

- [ ] **Step 7: Commit**

```bash
git add FE/src/context/ChatContext.jsx
git commit -m "feat(fe): settings setters fire debounced rebuild for the active session"
```

---

## Task 5: Frontend — "Reinitializing session…" indicator

**Files:**
- Modify: `FE/src/components/Input/ChatInput.jsx` — read `rebuilding` from `useChat()`; render a small badge above the input capsule when `rebuilding[currentThreadId]` is true.

**Why:** The rebuild is a 2s blocking operation. The user needs a visible signal that something is happening, so they don't keep clicking or assume the click was lost.

- [ ] **Step 1: Add `rebuilding` to the destructured `useChat()` return**

In `FE/src/components/Input/ChatInput.jsx`, find (around line 26):

```js
  const { isStreaming, sendMessage, stopStream, replyQuote, clearReplyQuote, settingSources, skillsList, skillsMode, permissionMode, currentCommands, currentThreadId } = useChat();
```

Change to:

```js
  const { isStreaming, sendMessage, stopStream, replyQuote, clearReplyQuote, settingSources, skillsList, skillsMode, permissionMode, currentCommands, currentThreadId, rebuilding } = useChat();
```

- [ ] **Step 2: Compute the indicator visibility**

Just after the existing `paletteOpen`/`filteredCommands` block (around line 118), add:

```js
  const isRebuilding = Boolean(currentThreadId && rebuilding[currentThreadId]);
```

- [ ] **Step 3: Render the badge above the input capsule**

In the JSX, find the outermost wrapper of the input (the one that contains the `paletteOpen` listbox and the input capsule). The cleanest place to insert the badge is right before the `paletteOpen` listbox, inside the same wrapper, so the layout is consistent.

Locate the existing `paletteOpen` JSX block:

```jsx
          {/* Slash command palette — pops above the textarea when input starts with / */}
          {paletteOpen && (
```

Immediately *before* that block, add:

```jsx
          {/* Rebuild indicator — shown while a settings change is reinitializing
              the active session's SDK client. Clears on the next commands_available
              broadcast (handled in ChatContext) or after the 6s safety timeout. */}
          {isRebuilding && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand/10 border border-brand/30 text-[11px] text-txt-muted"
            >
              <svg
                className="w-3 h-3 animate-spin text-brand"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="42 20" />
              </svg>
              <span>Reinitializing session…</span>
            </div>
          )}
```

- [ ] **Step 4: Build to confirm no compile errors**

Run:
```bash
cd FE && npm run build
```
Expected: build succeeds; new hash in `dist/assets/index-*.js`.

- [ ] **Step 5: Commit**

```bash
git add FE/src/components/Input/ChatInput.jsx
git commit -m "feat(fe): Reinitializing session indicator in ChatInput"
```

---

## Task 6: Verification

**Files:** none modified; manual + curl checks.

**Why:** The plan touches two processes (BE FastAPI server, FE dev server). A single end-to-end pass confirms the rebuild path, the broadcast, and the indicator all wire up.

- [ ] **Step 1: Start the BE server with the new code**

```bash
pkill -f chat_server.py 2>/dev/null; sleep 1
python chat_server.py
```

Expected: server logs `[REBUILD] ...` on the rebuild calls below.

- [ ] **Step 2: BE curl battery**

```bash
SID=$(python -c "import uuid; print(uuid.uuid4())")

# Test 1: cold rebuild with ["user"] scope
time curl -sS -X POST "http://localhost:8225/api/sessions/$SID/settings?workspace=." \
  -H "Content-Type: application/json" \
  -d '{"content":"","setting_sources":["user"],"skills":null,"permission_mode":null}'

# Test 2: rebuild to ["local"] (forces new cache key → ~2s)
time curl -sS -X POST "http://localhost:8225/api/sessions/$SID/settings?workspace=." \
  -H "Content-Type: application/json" \
  -d '{"content":"","setting_sources":["local"],"skills":null,"permission_mode":null}'

# Test 3: rebuild back to ["user"] (cache hit → fast)
time curl -sS -X POST "http://localhost:8225/api/sessions/$SID/settings?workspace=." \
  -H "Content-Type: application/json" \
  -d '{"content":"","setting_sources":["user"],"skills":null,"permission_mode":null}'

# Test 4: bad UUID
curl -sS -X POST "http://localhost:8225/api/sessions/not-a-uuid/settings?workspace=." \
  -H "Content-Type: application/json" \
  -d '{"content":"","setting_sources":["user"],"skills":null,"permission_mode":null}'

# Test 5: SSE-open with the new scope and confirm the broadcast matches
timeout 3 curl -Ns "http://localhost:8225/api/sessions/$SID/events?workspace=.&setting_sources=%5B%22user%22%5D" | head -3
```

Expected:
- Tests 1, 2, 3 all return `{"status":"rebuilt",...}`. Test 1 ~2s (cold SDK init), Test 2 ~2s (new scope cache miss), Test 3 < 200ms (cache hit).
- Test 4 returns HTTP 400.
- Test 5's first SSE event is `commands_available` with the user-scope list.

- [ ] **Step 3: FE manual smoke checklist**

In a browser, with the FE served from `FE/dist` (or `npm run dev`):

1. **Fresh session, no message yet** — open a new tab, type `/` in the input. Palette appears with the default command list. Now open Settings → change "Settings Sources" to "User (~/.claude)". Indicator should appear ("Reinitializing session…") for ~2s, then disappear. Type `/` again — palette now shows the user-scope list (includes user-scoped skills like `writing-plans`, `hallmark`).
2. **Toggle rapidly** — open Settings, click "User", then "Local", then "Default" within 1s. Only one rebuild fires (verify via `[REBUILD]` lines in the BE log — should see exactly one log entry for the sequence). Palette updates to the final scope's list.
3. **Mid-session change** — open an existing session, send a message, wait for the response to complete. Open Settings, change "Settings Sources". Indicator appears, then disappears after the next broadcast. Type `/` — palette matches the new scope. Send another message — the agent's response reflects the new skills/commands.
4. **No active session** — close the active session (click "+ New Conversation" without sending anything in the new one, or use a tab with no `currentThreadId`). Open Settings, change "Settings Sources". No indicator appears (no rebuild fires), but localStorage is updated. Open a new session, type `/` — palette shows the new scope (the SSE-open broadcast uses the new `?setting_sources=`).
5. **Permission mode change** — open Settings, click "Read Only". Indicator appears. After it clears, the running agent's tool calls are denied (try sending a message that requires file edits — should be refused).
6. **Cache hit on next message** — after a rebuild, send a message. The BE log should show `ensure_commands_broadcast` resolving to a cache hit (no second SDK init). Verify by checking that the message response time is normal (no extra 2s delay).
7. **Stuck-indicator safety** — kill the BE server mid-rebuild (during the 2s window). The indicator should clear after 6s (the safety timeout in Task 3 Step 6).

- [ ] **Step 4: Roll back if any check fails**

Each task is its own commit. To back out:

```bash
git revert --no-commit <commit-hash>
# or for the full plan
git reset --hard <hash-before-task-1>
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Tear down current client on settings change — Task 1 (disconnect), Task 2 (endpoint), Task 4 (trigger).
- ✅ Build new client with new settings — Task 1 (`_build_client` with explicit overrides).
- ✅ `--resume` preserves JSONL — Task 1 comment + existing `_build_client` (uses `resume=jsonl_path.exists()`).
- ✅ Broadcast fresh `commands_available` — Task 1 (calls `ensure_commands_broadcast`).
- ✅ Slash palette reflects new settings — Task 2 → Task 1 broadcast → existing `commands_available` handler in ChatContext.
- ✅ No active session — Task 4 (rebuildSession is a no-op without `currentThreadId`).
- ✅ Mid-turn rebuild — accepted as cost; Task 3 Step 4 (catch + clear indicator) + Task 5 (visible indicator).
- ✅ Multiple rapid changes — Task 3 Step 4 (400ms debounce + AbortController).
- ✅ First message after rebuild uses cache hit — implicit (Task 1 ends with `ensure_commands_broadcast` populating the cache; `_loop_body`'s existing per-turn re-broadcast hits the cache).

**2. Placeholder scan:** No "TBD", "TODO", "implement later", "similar to Task N", or "add appropriate error handling". Every step shows the actual code or command.

**3. Type consistency:** `settingSources` is `list | null` on the BE (matches `_UserMessage.setting_sources`), `list | null` on the FE (matches `getInitialSettingSources` + the setter). `skills` is `list | "all" | null` on the BE, the FE mirrors that shape via `skillsMode === 'all' ? 'all' : skillsList`. `permissionMode` is `string | null` on both sides. `rebuilding` is `{ [threadId]: boolean }` everywhere it's referenced. `rebuildSession` signature is consistent between the api.js helper and the ChatContext callback.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-31-rebuild-on-settings-change.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
