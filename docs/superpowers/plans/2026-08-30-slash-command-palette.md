# Slash Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude Agent SDK slash-command autocomplete palette to the chat input — when the user types `/`, show a popover listing the SDK's available commands with names, descriptions, and argument hints; arrow-key/Enter to select; insert `/<name> ` into the textarea. Commands are fetched once per session from the SDK via `client.get_server_info()`.

**Architecture:** Backend captures `client.get_server_info()` once after the SDK client connects and broadcasts a new `commands_available` SSE event with the full commands list. Frontend stores this list per session in ChatContext, derives a filtered view from the current input value, and renders a popover inside the existing input capsule. Settings changes do NOT trigger re-fetch — the command list is fixed at session start (per the SDK model: `setting_sources` and `skills` are locked on first message, and `permission_mode` doesn't gate commands).

**Tech Stack:** Python 3.12 (FastAPI, claude-agent-sdk), React 18, Vite 5, Tailwind 3. Existing patterns: SSE event broadcasting in `SessionLoop._broadcast`, reducer-based event handling in `ChatContext._handleSessionEvent`, controlled textarea in `ChatInput.jsx`.

## Global Constraints

- **Ponytail mode active** (level: full). Smallest correct diff. No speculative abstractions, no future-proofing.
- **Single-source convention**: backend broadcasts `commands_available`; FE reads it. Don't also parse the init SystemMessage's `slash_commands` field — `get_server_info()` is richer (description, argumentHint).
- **No new deps**. Use Tailwind classes already in the project. No icon libraries beyond the existing inline SVGs.
- **No FE test framework** exists; verify FE changes via `npm run build` (must succeed) + a manual smoke checklist. Verify BE via curl against a running session.
- **Style match**: `bg-dark-surface`, `text-brand` for command name, `text-txt-muted` for description, `text-txt-subtle` for argument hint. Selected row: `bg-brand/15`.
- **Existing settings state** in `ChatContext.jsx` is the model: `settingSources`, `skillsMode`, `skillsList`, `permissionMode`. We do NOT add new settings.
- **Comment style**: every non-obvious line gets a `// ponytail: ...` or `# ponytail: ...` comment.
- **Rollback**: each task is its own commit. If a task fails review or breaks something, `git revert <hash>` cleanly undoes just that task. Don't bundle multiple tasks into one commit.

## File Structure

**Modified files:**
- `chat_server.py` — `SessionLoop._loop_body` adds one `get_server_info()` call + broadcast; `SessionLoop._translate_sdk_message` adds a defensive `SystemMessage` no-op branch so the SDK's init event doesn't get mis-translated.
- `FE/src/context/ChatContext.jsx` — new `commands` map keyed by threadId, new reducer case in `_handleSessionEvent`, expose `commands` per current session.
- `FE/src/components/Input/ChatInput.jsx` — new local state for palette visibility/selection, new popover element rendered above the textarea, new keyboard handlers.

**Not modified:**
- `FE/src/utils/api.js` — no API call changes; commands arrive over the existing SSE stream.
- `FE/src/components/Modals/SettingsModal.jsx` — settings don't change commands; no refresh wiring.
- Backend route table — new event type piggybacks on existing `/api/sessions/{sid}/events` SSE endpoint.

---

## Task 1: Backend — capture commands and broadcast `commands_available`

**Files:**
- Modify: `chat_server.py:467-468` (the spot right after `self._client = await self._build_client(target_mode)` in `SessionLoop._loop_body`)

**Why:** `get_server_info()` is the canonical SDK method for full command metadata (name + description + argumentHint). Calling it once per session gives the FE everything it needs.

- [ ] **Step 1: Add the `get_server_info()` call in `_loop_body`**

In `chat_server.py`, find the block in `SessionLoop._loop_body` that reads:

```python
                self._client = await self._build_client(target_mode)
            self._current_permission_mode = target_mode
            # Reset per-turn state so each enqueued user message starts fresh.
```

Change it to:

```python
                self._client = await self._build_client(target_mode)
                # ponytail: capture the SDK's full command surface once, right after
                # the client connects. get_server_info() returns the cached
                # _initialization_result (no extra round-trip), so this is cheap.
                # We do it here (not in _build_client) so we don't pay it on
                # _build_options-only paths and so a future respawn picks up
                # commands from the freshly-connected client.
                try:
                    info = await self._client.get_server_info()
                    if info and isinstance(info.get("commands"), list):
                        await self._broadcast({
                            "type": "commands_available",
                            "commands": [
                                {
                                    "name": c.get("name"),
                                    "description": c.get("description", "") or "",
                                    "argumentHint": c.get("argumentHint", "") or "",
                                }
                                for c in info["commands"]
                                if c.get("name")
                            ],
                        })
                except Exception as e:
                    print(f"[WARN] get_server_info failed: {e}")
            self._current_permission_mode = target_mode
            # Reset per-turn state so each enqueued user message starts fresh.
```

- [ ] **Step 2: Verify the file still parses**

Run: `python3 -c "import ast; ast.parse(open('chat_server.py').read())"`
Expected: no output, exit 0.

- [ ] **Step 3: Restart the backend**

Run: `./restart_server.sh`
Expected: backend binds 0.0.0.0:8225, health check `curl localhost:8225/api/health` returns `{"status":"ok"}`.

- [ ] **Step 4: Verify `commands_available` arrives over SSE**

Two terminals, in this order. The SSE must be open BEFORE the POST so the broadcast has a subscriber.

Terminal 1 — open the SSE stream first (use a long `--max-time` so it stays alive long enough to catch the post-POST broadcast):

```bash
TID=$(python3 -c "import uuid; print(uuid.uuid4())")
WS=$(pwd)
curl -sN "http://localhost:8225/api/sessions/$TID/events?workspace=$WS" --max-time 30 > /tmp/sse-out.txt 2>&1 &
SSE_PID=$!
echo "TID=$TID"
echo $SSE_PID > /tmp/sse-pid.txt
```

Terminal 2 — trigger SDK client connect by sending a message (use the SAME TID):

```bash
TID=$(cat /tmp/sse-pid.txt | xargs -I{} ps -o args= -p {} 2>/dev/null | grep -oP '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
# If the regex above fails, re-export TID from terminal 1. Then:
WS=$(pwd)
curl -s -X POST "http://localhost:8225/api/sessions/$TID/messages?workspace=$WS" \
  -H 'Content-Type: application/json' \
  -d '{"content":"hi","setting_sources":null,"skills":null,"permission_mode":null}'
# Wait for the SDK to process, then check the SSE output:
sleep 4
kill $(cat /tmp/sse-pid.txt) 2>/dev/null
grep -m1 "commands_available" /tmp/sse-out.txt
```

Expected: the final `grep` prints a line containing `"type":"commands_available"`. You should also see at least one `name":"compact"` and `name":"clear"` in the parsed JSON.

If the grep finds nothing, check `/tmp/sse-out.txt` directly — it should have at least heartbeat frames even without a successful broadcast. If the file is empty, the BE didn't accept the SSE connection; check `chat_server.py` startup logs.

- [ ] **Step 5: Commit**

```bash
git add chat_server.py
git commit -m "feat(server): broadcast commands_available from SDK get_server_info"
```

---

## Task 2: Backend — defensive SystemMessage handler in `_translate_sdk_message`

**Files:**
- Modify: `chat_server.py:510-518` (the AssistantMessage block in `SessionLoop._translate_sdk_message`)

**Why:** Without this, if the SDK ever yields a `SystemMessage` for a different subtype that we haven't taught the translator to skip, the for-loop in `_loop_body` will see a non-iterable response. Cheap defensive add — a no-op branch that just `return`s. Ponytail: we already handle `StreamEvent`, `AssistantMessage`, `ResultMessage`; the `SystemMessage` family is missing.

- [ ] **Step 1: Add the SystemMessage case**

In `chat_server.py`, find:

```python
        from claude_agent_sdk import AssistantMessage, TextBlock
        if isinstance(sdk_event, AssistantMessage):
```

Add this block IMMEDIATELY before it:

```python
        from claude_agent_sdk import SystemMessage
        if isinstance(sdk_event, SystemMessage):
            # ponytail: the SDK yields a system/init SystemMessage at session
            # start. Its data.slash_commands duplicates what get_server_info()
            # already gave us (Task 1), and the description/argumentHint info
            # isn't present here, so we don't re-broadcast. We just need the
            # translator to acknowledge the type so a future subtype that
            # we DO care about doesn't fall through to the unhandled tail.
            return
```

- [ ] **Step 2: Verify the file still parses**

Run: `python3 -c "import ast; ast.parse(open('chat_server.py').read())"`
Expected: no output, exit 0.

- [ ] **Step 3: Restart + verify no regression**

Run: `./restart_server.sh`
Then send a real one-character message and confirm BOTH the new `commands_available` AND a normal `done` arrive (proving the SystemMessage no-op branch didn't swallow any non-system events):

```bash
TID=$(python3 -c "import uuid; print(uuid.uuid4())")
WS=$(pwd)
( curl -sN "http://localhost:8225/api/sessions/$TID/events?workspace=$WS" --max-time 30 > /tmp/sse-out.txt ) &
SSE_PID=$!
sleep 1
curl -s -X POST "http://localhost:8225/api/sessions/$TID/messages?workspace=$WS" \
  -H 'Content-Type: application/json' \
  -d '{"content":"hi","setting_sources":null,"skills":null,"permission_mode":null}'
sleep 6
kill $SSE_PID 2>/dev/null
echo "--- commands_available present? ---"
grep -m1 "commands_available" /tmp/sse-out.txt || echo "MISSING — check server logs"
echo "--- done present? (proves we didn't break the normal path) ---"
grep -m1 '"type":"done"' /tmp/sse-out.txt || echo "MISSING — regression!"
```

Expected: both greps print a line. If `commands_available` is missing but `done` is present, `get_server_info()` failed silently (check server log for `[WARN] get_server_info failed:`). If `done` is missing, the SystemMessage no-op branch swallowed something — check server log.

- [ ] **Step 4: Commit**

```bash
git add chat_server.py
git commit -m "fix(server): acknowledge SystemMessage in SDK translator"
```

---

## Task 3: Frontend — store and expose per-session commands in ChatContext

**Files:**
- Modify: `FE/src/context/ChatContext.jsx` — add `commands` state map; add reducer case in `_handleSessionEvent`; expose in context value.

**Interfaces:**
- Consumes: SSE event `{event: "message", data: {type: "commands_available", commands: [{name, description, argumentHint}]}}` from the existing `_handleSessionEvent` path.
- Produces: `commands` (array, per current session) read by `ChatInput.jsx`. Other consumers: none yet.

- [ ] **Step 1: Add `commands` state alongside `messages`**

In `FE/src/context/ChatContext.jsx`, find:

```javascript
  const [messages, setMessages] = useState({});
  const [sessionCursors, setSessionCursors] = useState({});
```

Add immediately after `sessionCursors`:

```javascript
  // ponytail: per-session SDK command list. Populated once when the BE
  // broadcasts commands_available (Task 1). The list is fixed for the
  // session's lifetime — settings changes don't re-fetch because the SDK
  // locks setting_sources/skills on the first message and permission_mode
  // doesn't gate commands. Reading components re-derive filtered views.
  const [commands, setCommands] = useState({});
```

- [ ] **Step 2: Add the reducer case in `_handleSessionEvent`**

In `_handleSessionEvent`, find the block that handles `data.type === 'context_usage'`:

```javascript
    if (data.type === 'context_usage') {
      setContextUsage(data.data);
      return;
    }
```

Add this immediately before it:

```javascript
    if (data.type === 'commands_available') {
      // ponytail: replace, don't merge. The BE broadcasts the full list once
      // per session, so any prior list for this session is stale (e.g. the
      // user created a new session with the same UUID by reloading).
      setCommands((prev) => ({ ...prev, [sessionThreadId]: data.commands || [] }));
      return;
    }
```

- [ ] **Step 3: Expose `commands` map AND `currentCommands` selector in the context value**

The context value is a plain object literal built inline above `<ChatContext.Provider value={value}>` near the bottom of `ChatProvider` (around line 1456 in the current file). Add BOTH entries to that object:

```javascript
    commands,  // { [threadId]: [{name, description, argumentHint}] } — the raw map
    currentCommands: commands[currentThreadId] || [],  // selector for the active session
```

`commands` is the raw per-session map (exposed for future consumers / debugging). `currentCommands` is the selector `ChatInput.jsx` actually reads — Task 4 destructures it directly. Exposing both in this single step means the palette is fully wired the moment Task 3's commit lands; no follow-up task required.

- [ ] **Step 4: Verify the FE still builds**

Run: `cd FE && npm run build`
Expected: build succeeds; new bundle written to `FE/dist/assets/index-*.js`.

- [ ] **Step 5: Commit**

```bash
git add FE/src/context/ChatContext.jsx
git commit -m "feat(fe): store per-session SDK commands in ChatContext"
```

---

## Task 4: Frontend — palette state + filter logic in ChatInput

**Files:**
- Modify: `FE/src/components/Input/ChatInput.jsx` — add palette state, filter derived value, no rendering yet.

**Why:** Get the data flow right before adding the DOM. The popover is a single render block; the state machinery is what could break in subtle ways.

- [ ] **Step 1: Add the destructured `commands` from context**

In `ChatInput.jsx`, find the `useChat()` destructure:

```javascript
  const { isStreaming, sendMessage, stopStream, replyQuote, clearReplyQuote, settingSources, skillsList, skillsMode, permissionMode } = useChat();
```

Change to:

```javascript
  const { isStreaming, sendMessage, stopStream, replyQuote, clearReplyQuote, settingSources, skillsList, skillsMode, permissionMode, currentCommands } = useChat();
```

- [ ] **Step 2: Add palette state next to the existing input state**

Find:

```javascript
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
```

Add after `isDragging`:

```javascript
  // ponytail: slash-command palette. visible when input starts with `/` and
  // has no whitespace yet (we don't autocomplete across words). selectedIndex
  // resets to 0 every time the query changes — the user always starts at the top.
  const [paletteSelected, setPaletteSelected] = useState(0);
```

- [ ] **Step 3: Compute the palette query + filtered list**

Add these two consts right before the existing `hasText` line:

```javascript
  const paletteMatch = inputText.match(/^\/(\S*)$/);
  const paletteOpen = Boolean(paletteMatch) && (currentCommands || []).length > 0;
  const paletteQuery = paletteMatch ? paletteMatch[1].toLowerCase() : '';
  const filteredCommands = paletteOpen
    ? (currentCommands || []).filter(
        (c) =>
          c.name.toLowerCase().includes(paletteQuery) ||
          (c.description || '').toLowerCase().includes(paletteQuery)
      )
    : [];
  // ponytail: clamp selectedIndex when the filter result shrinks (e.g. user
  // backspaces). Without this, arrow keys would land on a phantom row.
  const safeSelected = filteredCommands.length === 0
    ? 0
    : Math.min(paletteSelected, filteredCommands.length - 1);
```

- [ ] **Step 4: Reset `paletteSelected` when the query changes**

Add this effect right after the existing `useEffect` blocks (before `handleUploadFiles`):

```javascript
  useEffect(() => {
    setPaletteSelected(0);
  }, [paletteQuery]);
```

- [ ] **Step 5: Commit**

```bash
git add FE/src/components/Input/ChatInput.jsx
git commit -m "feat(fe): slash command palette state + filter"
```

(The final `npm run build` runs once at the end of the plan, in Task 6, not after every FE step. Intermediate FE-only changes are verified by reading the diff and the smoke check in Task 5.)

---

## Task 5: Frontend — render palette popover and wire keyboard nav

**Files:**
- Modify: `FE/src/components/Input/ChatInput.jsx` — render the popover above the textarea; extend `handleKeyDown` for arrow/Enter/Tab/Esc when palette is open; add `selectPaletteCommand` handler.

- [ ] **Step 1: Add `selectPaletteCommand` helper**

Add this function before `handleSend`:

```javascript
  const selectPaletteCommand = (cmd) => {
    if (!cmd) return;
    // ponytail: insert "/<name> " so the user can keep typing arguments.
    // argumentHint (e.g. "(file path)") is not auto-inserted — it's a hint
    // shown in the palette, not literal text. Trailing space matches the
    // user-typed pattern (every command in their prompts ends with a space
    // before its arg, or no arg at all).
    setInputText(`/${cmd.name} `);
    setPaletteSelected(0);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };
```

- [ ] **Step 2: Extend `handleKeyDown` for palette navigation**

Find `handleKeyDown`:

```javascript
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isMobileView()) {
        return; // On mobile, enter is a newline
      }
      e.preventDefault();
      handleSend();
    }
  };
```

Replace with:

```javascript
  const handleKeyDown = (e) => {
    if (paletteOpen && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPaletteSelected((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPaletteSelected((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectPaletteCommand(filteredCommands[safeSelected]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // ponytail: Esc strips the leading `/` so the palette closes. The
        // remaining query text is kept — the user can keep typing without
        // re-typing the slash. Next keystroke re-evaluates paletteOpen.
        setInputText(inputText.replace(/^\/(\S*)$/, '$1'));
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isMobileView()) {
        return; // On mobile, enter is a newline
      }
      e.preventDefault();
      handleSend();
    }
  };
```

- [ ] **Step 3: Render the popover above the textarea**

Find the `<textarea>` block:

```javascript
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={attachments.length > 0 ? "Add a message about these images..." : "Type a message or prompt..."}
            className="w-full bg-transparent text-xs sm:text-sm text-txt-main placeholder-txt-subtle focus:outline-none resize-none max-h-48 font-sans leading-relaxed block overflow-y-auto min-h-[26px] px-1.5 py-1"
          />
```

Insert this block IMMEDIATELY BEFORE the `<textarea>`:

```javascript
          {/* Slash command palette — pops above the textarea when input starts with / */}
          {paletteOpen && (
            <div
              role="listbox"
              aria-label="Slash commands"
              className="z-30 max-h-64 overflow-y-auto bg-dark-surface border border-dark-border rounded-xl shadow-2xl py-1"
            >
              {filteredCommands.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-txt-subtle italic">
                  No matching commands
                </div>
              ) : (
                filteredCommands.map((cmd, idx) => (
                  <button
                    key={cmd.name}
                    type="button"
                    role="option"
                    aria-selected={idx === safeSelected}
                    onMouseDown={(e) => {
                      // ponytail: mousedown (not click) so the textarea doesn't
                      // lose focus before the state update lands.
                      e.preventDefault();
                      selectPaletteCommand(cmd);
                    }}
                    onMouseEnter={() => setPaletteSelected(idx)}
                    className={`w-full text-left px-2.5 py-1.5 flex items-baseline gap-2 transition-colors cursor-pointer ${
                      idx === safeSelected ? 'bg-brand/15 text-white' : 'text-txt-main hover:bg-dark-elevated'
                    }`}
                  >
                    <span className="font-mono text-xs text-brand shrink-0">/{cmd.name}</span>
                    {cmd.argumentHint ? (
                      <span className="font-mono text-[10px] text-txt-subtle shrink-0">{cmd.argumentHint}</span>
                    ) : null}
                    <span className="text-[11px] text-txt-muted line-clamp-1 flex-1 min-w-0">
                      {cmd.description}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
```

- [ ] **Step 4: Manual smoke check (no FE test framework exists)**

Open `http://localhost:8225/` in a browser. Steps:
1. Open an existing session (or start a new one) and wait ~1s for the `commands_available` event. To verify it arrived, open DevTools → Network → filter on `/events` and look for a `message` event whose `data.type` is `commands_available`.
2. Click the textarea. Type `/`. Popover should appear with the full commands list.
3. Type `/com`. Popover should narrow to commands containing "com" (e.g. `/compact`).
4. Press ↓ once. The second row should highlight.
5. Press Enter. Textarea should now contain `/compact ` and the popover should close.
6. Press Backspace a few times until text is just `/` again. Popover reopens.
7. Press Esc. The textarea content should change from `/com` to `com` (leading `/` stripped, rest preserved), and the popover should close.
8. Type a regular message like "hello". No popover. Press Enter. Message sends normally.

If any step fails, fix and re-run. Do NOT skip the `commands_available` network check (step 1) — without it, the rest of the smoke test is meaningless (the FE has nothing to render).

- [ ] **Step 5: Commit**

```bash
git add FE/src/components/Input/ChatInput.jsx
git commit -m "feat(fe): render slash command palette with keyboard nav"
```

---



## Task 6: Final build + restart + manual end-to-end check

**Files:** none modified. This task is a sanity gate.

- [ ] **Step 1: Build the FE for production**

Run: `cd FE && npm run build`
Expected: build succeeds.

- [ ] **Step 2: Restart the BE**

Run: `./restart_server.sh`
Expected: server back up; `curl localhost:8225/api/health` returns 200.

- [ ] **Step 3: End-to-end checklist**

Open the app in a fresh browser tab. Verify:

1. Palette opens on `/` and shows the full command list with descriptions.
2. Typing narrows the list (case-insensitive, matches name OR description).
3. ↑/↓/Enter/Tab/Esc all work; mouse click also works.
4. Selecting inserts `/<name> ` (trailing space).
5. The SDK actually dispatches the command — send `/context` and verify a `context_usage` event arrives.
6. Open Settings, change Permission Mode to "Read-Only". Send another `/` — list is unchanged (correct: settings don't change commands mid-session).
7. **Existing-session resume** — open a session from the sidebar (not a new one), wait for the SSE to open, send a message. The `commands_available` event should fire on the resumed session's fresh SDK connect, and the palette should populate. This proves the resume path works.
8. Reload the page. New session starts. Palette re-populates from the new init's `commands_available`.

- [ ] **Step 4: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore: slash command palette final cleanup"
```

---

## Self-Review

**Spec coverage:**
- "At the start we load the commands in the conversation" → Task 1 broadcasts, Task 3 stores + exposes the selector. ✓
- "When someone types / in the chat bot we show the command list" → Task 4 detects, Task 5 renders. ✓
- "Allow to use different command" → Task 5 inserts on select. ✓
- "When a permission or other things from the settings panel change we refresh this commands part" → **Deliberately skipped**. The SDK locks `setting_sources`/`skills` on session start and `permission_mode` doesn't gate commands, so the list is genuinely fixed per session. Documented in the Architecture section above; surfaced in this plan so the user can object. **Action**: if the user objects, add a Task 2.5 that re-fetches on settings change (returns same data; cosmetic).
- "First research then implement" → done in the prior conversation turn (research findings were the basis for this plan).

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "fill in details" / "appropriate handling" anywhere. Every step has concrete code or commands. ✓

**Type consistency:**
- `commands_available` event shape: defined in Task 1 as `{type, commands: [{name, description, argumentHint}]}`. Consumed in Task 3 by destructuring `data.commands`. ✓
- `currentCommands` name: introduced in Task 4 destructure, defined in Task 3 (was Task 6 before the merge) context value. ✓
- `selectPaletteCommand` name: introduced in Task 5, called in Task 5. ✓
- `paletteMatch` / `paletteQuery` / `paletteOpen` / `filteredCommands` / `safeSelected`: all defined in Task 4, used in Task 5. ✓
- `paletteSelected` state: defined in Task 4, used in Task 4 (effect) and Task 5 (handlers). ✓

**Verdict:** plan is complete and self-consistent. Ready for execution.
