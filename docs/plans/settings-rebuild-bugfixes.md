# Settings-Rebuild Bugfix Plan

Six confirmed bugs in the live settings-rebuild feature (commits 20c58fa..b8d87f3).
Smallest diff first. Backend = `chat_server.py`, frontend = `FE/src`.

---

## Step 1 — FE: stop the aborted POST from stealing the new timer entry
**File:** `FE/src/context/ChatContext.jsx` (~line 340)

In `rebuildSession`'s `setTimeout` callback, `finally { delete rebuildTimersRef.current[threadId] }`
runs unconditionally. When a newer change aborted this POST, the entry in the ref is already the
*newer* one — the delete orphans it, so the next change can't `clearTimeout`/abort the newer
timer → two overlapping rebuild POSTs.

Fix (one line):
```js
// ponytail: only delete our own entry — an aborted POST must not evict the
// replacement entry a newer change already registered.
if (rebuildTimersRef.current[threadId]?.controller === controller) {
  delete rebuildTimersRef.current[threadId];
}
```
**Verify:** in one session toggle two settings <400 ms apart while a slow rebuild POST is in
flight (throttle network); devtools: only one non-aborted `/settings` POST completes.

---

## Step 2 — BE: serialize rebuild + turns with the existing (unused) `_session_lock`
**File:** `chat_server.py` — `_session_lock` (~line 879), `post_session_settings` (~line 1591),
`SessionLoop._loop_body` (~lines 607–690)

Two bugs, one lock:
- **Concurrency:** two overlapping `POST /settings` both read `old_client = self._client`
  before either swaps → one built `ClaudeSDKClient` subprocess is never disconnected (leak) and
  the staler build can win.
- **Mid-turn kill:** a rebuild during a turn disconnects the client that `query`/
  `receive_response` (~lines 660–662) is streaming on — the turn dies and any pending
  `permission_request` resolves into nothing.

`_session_lock(sid)` (async helper returning a per-sid `asyncio.Lock`, dict guarded by
`_cache_lock`) already exists and is used nowhere — wire it in:

1. In `_loop_body`, wrap the per-message processing block (from the locked-settings/respawn
   check through the end of the `try/except` around `receive_response`) in
   `async with await _session_lock(self.session_id):`.
2. In `post_session_settings`, wrap the `loop.rebuild_with_settings(...)` call in the same lock.

A settings POST then waits for the in-flight turn to drain, then rebuilds — correct by
construction, no `_turn_active` flag needed.

Known consequence (document in a ponytail comment): the FE's 6 s stuck-indicator safety net
(`ChatContext.jsx` ~lines 97–113) can expire while the POST legitimately waits on a long turn.
Accept: the `commands_available` broadcast after the rebuild still refreshes the palette; the
indicator just disappears early. Do NOT lengthen the timeout.

**Verify:**
- `curl` two `POST /settings` concurrently → `[REBUILD]` lines sequential, no orphan
  `claude` subprocess (`ps aux | grep claude` count stable).
- `POST /settings` mid-long-turn → returns only after `done` event, turn output intact.

---

## Step 3 — BE: include skills in the commands cache key
**File:** `chat_server.py` — `_ss_cache_key` area (~line 197), `ensure_commands_broadcast`
(~lines 323, 336)

Cache key `(workspace, _ss_cache_key(setting_sources))` ignores skills, but skills surface as
slash commands — toggling skills serves the palette list built under the old skill scope.

Add a sibling helper and extend the single `cache_key` assignment (~line 323; the cache write at
~336 reuses the same local, so one edit covers read + write):
```python
def _skills_cache_key(skills):
    """Hashable cache key for skills. None ⇒ SDK defaults, 'all' ⇒ sentinel, list ⇒ sorted tuple."""
    if skills is None or skills == "all":
        return skills
    return tuple(sorted(skills))
```
`cache_key = (self.workspace, _ss_cache_key(setting_sources), _skills_cache_key(skills))`

**Also here (required before Step 4, not after):** `_ss_cache_key` collapses `[]` and `None` to
the same key (`if not setting_sources: return None`). That was harmless while `[]` was
unreachable; Step 4 makes `[]` = "no sources" a real value distinct from `None` = "SDK default",
so the key must distinguish them or a no-sources rebuild serves the default-sources cached list:
```python
def _ss_cache_key(setting_sources):
    """None ⇒ SDK defaults; [] ⇒ explicitly no sources. NOT interchangeable."""
    if setting_sources is None:
        return None
    return tuple(sorted(setting_sources))  # () for [] — distinct from None
```
Same None-vs-[] distinction applies via `_skills_cache_key` (skills `[]` reaches it raw from the
locked-settings path before `_build_options` coerces it).

Note in a comment: the SSE-open call site (~line 1662) passes only `setting_sources`, so it keys
with `skills=None`; acceptable — its broadcast matches the default-skills client it builds, and a
later rebuild broadcasts the right list for its own scope.

**Verify:** restart server, session A: set custom skills (rebuild logs a cache miss + fresh
`[REBUILD]`), toggle back — palette list contents change with the toggle (check
`commands_available` payloads in devtools network stream).

---

## Step 4 — BE: `[]` means "none" for setting_sources on the rebuild path too
**File:** `chat_server.py` — `rebuild_with_settings` (~lines 359–362)
**Depends on Step 3** (the None-vs-`[]` cache-key split); do not land without it or this step
ships a new stale-palette bug.

Delete `if setting_sources == []: setting_sources = None`. `None` means "fall through to
_locked_settings" (`_build_client` ~line 584) / "SDK default" (`_build_options`), while the
message path honors `[]` = no sources. Today, rebuild-deselect-all silently resurrects the
locked scope. With `[]` preserved, `_build_client`'s fallthrough condition
(`setting_sources is None and skills is None`) correctly doesn't trigger and options get `[]`.

Keep the `skills == []` behavior: the SDK hangs on `skills=[]` (existing ponytail comment in
`_build_options` ~line 1156 does the coercion). Leave the rebuild-side `skills == [] → None` line
as-is with a ponytail pointer so both coercions live in one obvious place each.

**Verify:** session with `setting_sources=["user"]`: first message locks it in; POST rebuild with
`setting_sources: []` → `[SDK_OPTS]` log shows `setting_sources=[]`; next turn's tools/commands
reflect no user-scope sources.

---

## Step 5 — FE: fix the skills wire mapping everywhere, make "none" honest
**Files:** `FE/src/context/ChatContext.jsx` (4 setters, ~lines 1542–1580),
`FE/src/components/Input/ChatInput.jsx` (~line 156, the message-send path — same bug, do not
skip it), `FE/src/components/Modals/SettingsModal.jsx` (~line 57 copy)

The `skillsMode === 'all' ? 'all' : skillsList` expression (repeated 5× across the two files) is
wrong for two of the four modes. Actual modes: `'default' | 'none' | 'custom'` (+ legacy `'all'`
from old localStorage). Correct wire mapping:

| mode | wire value |
|---|---|
| `default` | `null` (SDK discovery) — today wrongly sends stale `skillsList` |
| `none` | `[]` — today wrongly sends stale `skillsList` |
| `custom` | `skillsList` |
| `all` | `'all'` |

- One shared pure helper (new file `FE/src/utils/settingsWire.js`, exported
  `skillsWireValue(mode, skillsList)`); use it in all 4 ChatContext setters **and** ChatInput's
  `skillsForSend` (~line 156).
- Copy fix: "none" description reads e.g. `[] (sent as-is; currently behaves like SDK default —
  SDK hangs on empty skills list, coerced server-side)`. The mode still can't truly disable
  skills; the copy must say so.

**Verify:** with a custom list present, switch to "default" → rebuild POST body has
`skills: null`; switch to "none" → `skills: []`; send a message in "none" mode → ChatInput's POST
body also `skills: []`; modal copy no longer promises "no skills at all".

---

## Out of scope (noted, not fixed)
- Rebuild with `cmds` empty → no `commands_available` broadcast → indicator rides the 6 s net
  (`if cmds:` in `ensure_commands_broadcast`). Rare; the net exists for this.
- SSE-open broadcast can't see skills at all (no query param). Adds one more query param for a
  pre-first-message palette edge; skip until someone reports it.
- The `skills=[]` SDK hang itself — upstream; check if a newer `claude_agent_sdk` fixed it, then
  delete both coercions and the "none" caveat.

## Manual test pass (final)
1. `./restart_server.sh`, open one session, send a message.
2. Toggle each setting (sources, skills modes, permission mode) → one debounced POST,
   "Reinitializing…" clears on `commands_available`, palette matches scope.
3. Concurrent-POST and mid-turn POST curls from Step 2 verify.
4. `ps` subprocess count returns to baseline after a burst of rebuilds.
