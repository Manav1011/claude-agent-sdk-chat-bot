# Step 4: Execution

This step covers execution ONLY: `session_start(exploration=False)` → execute freely → wait_for_* as needed.

**Only start this step after the user approves the plan in step 3.** `exploration=False` means the session auto-logs every action tool call.

## Setup

**Two separate sessions:**
1. **Exploration session** — Already done in step 2 (Live Exploration). READ-ONLY, used `exploration=True`.
2. **Recording session** — Start fresh here. Execute the automation. Uses `exploration=False` so action tools auto-log.

Do NOT use the exploration session for recording. Start a new `session_start()` for recording.

1. **session_start** — `session_start(base_dir=Path.cwd() / "automation-wiki" / "{name}", exploration=False)`. `exploration=False` enables auto-logging.

**Do NOT call `start_recording()` in this step.** Recording tools (`start_recording`, `record_step`, `stop_recording`, `list_log_entries`) are called ONLY in Step 5, AFTER execution is complete and you've verified the log.

For session details, read [references/supporting/session_setup.md](references/supporting/session_setup.md).

## Error Protocol (MUST FOLLOW)

**Do NOT retry without understanding WHY a step failed.** Trial-and-error is forbidden. Each failed attempt without understanding is wasted time.

### On Any Failure:
1. **STOP the recording loop.** Do not keep executing more steps.
2. **Take a snapshot** of the current page state.
3. **Read the relevant source code** to understand why the step failed.
4. **Fix based on code understanding** — not guesswork.
5. **Resume recording** only after root cause is understood.

### Trial-and-Error is Forbidden
- Do NOT try a different selector → retry → screenshot → try again → retry
- Do NOT keep retrying the same action with slight variations
- Each failed attempt without understanding is wasted time

### Examples:

**Bad (Trial-and-Error Loop):**
```
fill("#field-a", "value") → works
fill("#field-b", "value") → works
fill("#field-c", "value") → found: false
→ screenshot()
→ tries again → fails again
→ waits 2 seconds → tries again → fails
→ finally succeeds after 3 retries
```
Keeps retrying without understanding why. Next run might fail again.

**Good:**
```
fill("#field-c", "value") → found: false
→ STOP (Error Protocol)
→ Reads Form.tsx → finds `#field-c` is inside a conditional panel that requires `#field-b` to be "validated" (blur event)
→ Adds `press_key("#field-b", "Tab")` to trigger validation
→ Resume recording — succeeds
```

**Bad:**
```
click("#next-btn") → found: false
→ screenshot()
→ tries "#btn-next" → fails
→ tries "button:has-text('Next')" → fails
→ tries again with timeout=10000 → finally works
```
Retrying with different selectors without understanding why. Wastes time.

**Good:**
```
click("#next-btn") → found: false
→ STOP (Error Protocol)
→ Reads Wizard.tsx → finds #next-btn only renders after Step 3 fields are filled
→ Adds missing fill steps for Step 3
→ Resume recording — click succeeds
```

## Replay Dependencies First — MANDATORY

**Before starting ANY session for this automation, you MUST replay dependencies first.** This is not optional.

**Heavy reliance on snapshots and screenshots during replay:**
- Take a snapshot/screenshot after each dependency replays
- Verify the page is in the correct state before proceeding
- If something looks wrong → STOP, read the code, understand why

**If the automation has dependencies (from step 1):**
1. Call `list_recordings(wiki_root=...)` to see available recordings
2. For each dependency identified in step 1:
   - Call `replay_automation(automation_path="{dep_path}", session_id=current_session)`
   - **Take a snapshot/screenshot** — verify the page is in the correct state
   - Wait for replay to complete successfully
3. **Only after ALL dependencies are replayed** → proceed with `session_start()` for recording

**If no dependencies → skip this section.**

**Example:**
```
User says: "This automation depends on 'login'"
1. list_recordings(wiki_root="/path/to/automation-wiki")
2. replay_automation(automation_path="recordings/login_xxx.json", session_id="current_session")
3. snapshot() → verify login succeeded, no unexpected modals
4. session_start(base_dir=..., exploration=False) → start recording session
```

**Why:** The recording only contains the NEW steps (after dependencies), not the dependency steps themselves. This matches the batch replay environment exactly.

## Execute (Decision Tree)

Use the selector priority from [references/supporting/selector_priority.md](references/supporting/selector_priority.md). Apply the appropriate path below based on the scenario:

### Form fields → `fill()` per field — NEVER `execute()` for writing

Use `fill(selector, value)` for every form field. One step per field. **NEVER use `execute()` to fill form fields** — `execute()` is read-only (computed styles, `__NEXT_DATA__`, storage).

```
fill("#field-a", "value-a")
fill("#field-b", "value-b")
fill("#field-c", "value-c")
```

**Important:** `fill()` argument name is `value`, not `text`. Wrong: `{"selector": "#field-a", "text": "..."}`. Correct: `{"selector": "#field-a", "value": "..."}`.

These are auto-logged — no `record_step` calls needed during execution.

### Internal page → navigate → click/fill using already-verified selectors

```
navigate("{{TARGET_URL}}")
→ wait_for_load_state("networkidle")
→ click("a[href='/target-route']")  ← use selector from discovery (Phase 1)
→ wait_for_url("*target-route*", timeout=5000)
```

All actions auto-log — no `record_step` calls during execution.

**Do NOT re-run graphify or re-read code during recording.** Selectors were verified in discovery. If a selector doesn't work during recording → Error Protocol applies (STOP → read code → understand → fix).

### Third-party → navigate → fill/click directly

```
navigate("https://third-party.com/login")
→ fill("input#username", "user@example.com")
→ fill("input#password", "password")
→ click("button[type='submit']")
→ wait_for_url("https://app-domain.com/*")
```

### Click fails → STOP → Read code to understand why → then fix

When `click()` fails, Error Protocol applies. Do NOT try different selectors until one works.

```
click("button:has-text('Submit')") → found: false
→ STOP (Error Protocol)
→ snapshot() — see what page actually shows
→ Read the relevant component code — understand why the element isn't there
  - Element exists but in a different state? → add the missing step
  - Element is conditional? → understand the condition
  - Wrong selector? → find the correct one from code
→ Fix the root cause
→ Resume recording
```

**Snapshot tells you WHAT failed. The code tells you WHY.** Always read the code before fixing.

### Examples:

**Bad:** `click()` fails → tries 3 different selectors until one works → records the working selector without understanding why the others failed → next replay fails because the working selector was coincidental.

**Good:** `click()` fails → STOP → reads the component → finds the element is inside a portal rendered by a modal that opens on a previous step → adds the missing modal-open step → records correctly.

## Wait Strategy

See [references/supporting/wait_strategy.md](references/supporting/wait_strategy.md) for all wait rules:
- Auth0/OAuth callback → `wait_for_load_state("networkidle")`
- Known URL redirect → `wait_for_url("*target*", timeout=5000)`
- Dynamic content loading → `wait_for_load_state("networkidle")`
- Form submit (no URL change) → `wait_for_selector("selector-on-next-page")` or `wait_for_load_state`
- SPA (no URL change after submit) → wait for a DOM element on the next page. NOT text or URL.
- `sleep()` — forbidden, use `wait_for_*`

## How Recording Works

**Phase 1 (Step 4) = Execute only.** Action tools auto-log to a session log file. Do NOT call `record_step`, `list_log_entries`, `start_recording`, or `stop_recording` in this step. Just execute.

**Phase 2 (Step 5) = Recording only.** After execution is COMPLETE, read the log, curate steps, and stop recording. This eliminates the #1 failure mode: "agent forgot to record."

### Tools that Auto-Log (Action Tools)

These are logged automatically during the session:
- `navigate` — Navigate to URL
- `click` — Click element
- `fill` — Fill text input
- `type` — Type text
- `check` — Check checkbox/radio
- `select_option` — Select dropdown option
- `press_key` — Press keyboard key
- `upload_file` — Upload file

### Tools that Do NOT Auto-Log

These are NOT auto-logged and do NOT need `record_step`:
- `snapshot`, `screenshot`, `list_tabs`, `console_messages` (query/verification)
- `get_text`, `get_value`, `get_attribute` (read-only)
- `assert_*` (assertion)
- `wait_for_*` (waiting primitives)
- `session_*`, `start_recording`, `stop_recording`, `register_recording` (setup)
- `execute`, `fill_form` (utility)
- `replay_*`, `batch_replay_*` (replay)
- `record_step` itself
- `close_tab`, `switch_tab`, `new_tab` (tab management)

### Optional vs Compulsory Steps

During **curation** (step 3 above), decide whether each step is **optional** or **compulsory**:
- **Compulsory** (default): the element must always exist.
- **Optional**: the element only appears sometimes (transient UI). Mark with `optional=true`.

**ONLY mark as optional if the element is truly transient AND appears at a predictable time:**
- Consent banners/popups that appear on first visit
- Feature tour/onboarding screens

**NEVER mark as optional:**
- Modal/dialog dismiss steps — mark as **compulsory**. Optional modal dismiss causes the modal to be skipped if it hasn't rendered yet, then it appears mid-flow and blocks all subsequent steps silently.
- Core flow buttons ("Submit", "Save", "Hire Associate")
- Login form fields
- Navigation elements

```
# From the log: review the entry, then curate:
record_step(session_id=..., tool_name="fill", args={"selector": "#email", "value": "{{EMAIL}}"})

# Optional step (consent banner — only if truly transient)
record_step(session_id=..., tool_name="click", args={"selector": 'button:has-text("Accept")'}, optional=true)
```

For record_step signature, see [references/supporting/recording_format.md](references/supporting/recording_format.md).

## STOP — Do NOT call stop_recording until execution is COMPLETE

**Execution is COMPLETE when ALL of these are true:**
1. All planned steps are executed successfully
2. The success criteria are met (e.g., success toast appears, redirect happens, element is visible)

**Do NOT call recording tools in this step.** `start_recording()`, `record_step()`, `list_log_entries()`, and `stop_recording()` are Step 5 tools only. If execution fails:
- Error Protocol applies → STOP → read code → understand → fix → resume
- If the issue cannot be resolved → `session_close()` and report to user. Do NOT try to curate or stop recording.

**After execution is COMPLETE, you have finished Step 4.** Now read `references/step_5_recording.md` and follow ALL its steps.