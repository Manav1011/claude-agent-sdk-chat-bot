# Step 5: Stop Recording, Session Close, Update Wiki

**This step runs after the user confirms the automation is complete (step 4 gate).**

Follow this order strictly — do NOT skip ahead to wiki update or session close before stopping recording and asking about registration:

## 5a. Curate and Stop Recording — MANDATORY

**DO NOT call `stop_recording()` directly.** You MUST curate the recording from the auto-log first. Skipping this step means the recording will be incomplete or missing steps.

**Curate the recording from the auto-log:**

1. **Read the log** — `list_log_entries(session_id=..., limit=200)` to see all actions taken during execution
2. **Review entries** — identify meaningful steps from the log
3. **Curate** — for each meaningful step, call `record_step(tool_name=..., args=...)` with `optional=true` when appropriate (see Step 4 for Optional vs Compulsory rules)
4. **Stop recording** — `stop_recording(session_id=...)` to save the curated recording

For the record_step signature and stop_recording output, read [references/supporting/recording_format.md](references/supporting/recording_format.md).

Key points:
- The recorded JSON stores **exact values** as recorded — no placeholder substitution, no variable extraction.
- Steps marked with `optional=true` are preserved in the JSON. During replay, optional steps are skipped if their target element doesn't exist, preventing failures from transient UI elements (modals, banners).

## 5b. Inspect Recording (MANDATORY)

**After `stop_recording()` succeeds, inspect the recording file BEFORE anything else.**

Read the recording JSON file and verify:

1. **No replay tools recorded** — Check that `replay_automation`, `replay_interactions`, `batch_replay` are NOT in the tools list. If they are, remove them.

2. **No query/setup tools recorded** — Check that `snapshot`, `screenshot`, `list_tabs`, `console_messages`, `session_start`, `session_close`, `get_text`, `get_value`, `assert_*` are NOT in the tools list. If they are, remove them.

3. **All core steps are present** — Check that the recording includes:
   - Navigation to the starting page
   - All form fills
   - All clicks on action buttons
   - Final verification step (if applicable)
   - If steps are missing, the recording is incomplete — re-record or ask user to continue

4. **Transient UI steps are marked optional** — Check that modal dismissals, consent banners, etc. have `optional=true`. If not, add it.

**If the recording is wrong:**
- Remove incorrect tools
- Add missing steps (if you remember what they were)
- If you can't fix it, tell the user: "The recording is incomplete. Steps missing: [list]. Should I re-record?"

**Example of bad recording:**
```json
{
  "tools": [
    {"tool": "replay_automation", ...},  // ← REMOVE THIS
    {"tool": "navigate", ...},
    {"tool": "click", ...}
  ]
}
```

**Example of good recording:**
```json
{
  "tools": [
    {"tool": "navigate", ...},
    {"tool": "click", ...},  // Core flow
    {"tool": "click", "args": {"selector": 'button:has-text("Ignore")'}, "optional": true}  // Transient UI
  ]
}
```

**After inspection, if the recording is correct → proceed to variable marking (5b.5).**
**If the recording is wrong → fix it or tell the user.**

## 5b.5. Mark Variables (MANDATORY)

**After inspection passes (5b), mark dynamic values as variables BEFORE replay (5c).**

The recording JSON has `"variables": []` and `"defaults": {}`. The AI agent edits this file to enable parameterized replay.

**How to identify variables:**
- Look at `fill` steps with selectors containing `email`, `password`, `user`, `username`, `phone`, `name`, `address`, `dob`, `date`, `age`
- Look at `navigate` steps with values that look like URLs or paths
- Look at any field where the user would want to replay with different data

**Automatic function matching:**

Before asking the user, check if the selector matches an available smart function:

| Selector pattern | Function | Example output |
|-----------------|----------|---------------|
| `email`, `user_email`, `email_address` | `{{random_email()}}` | `"abc123@test.com"` |
| `phone`, `mobile`, `tel` | `{{random_phone()}}` | `"(555) 123-4567"` |
| `dob`, `date_of_birth`, `date` | `{{current_date("YYYY-MM-DD")}}` | `"1999-01-07"` |
| `name`, `username`, `full_name` | `{{random_string(8)}}` | `"lpGP02UV"` |
| `age`, `years` | `{{random_int(18, 65)}}` | `35` |

If a function matches, use it as the default automatically. Only ask the user for a default when:
- No function matches (e.g., `password`, `ssn`, `employee_id`)
- The user wants a specific value

**What to do:**
1. Read the recording JSON file
2. For each candidate field, check for function match first
3. Ask the user: *"Should this be a variable?"*
   - Use `AskUserQuestion` to present options (not free-text)
4. For fields the user marks as variables:
   - If a function matches: use it as the default, show the user: `"Matched function: {{random_email()}}. Use this or provide a literal default?"`
   - If no function matches: ask for a default value (e.g., `"Default for PASSWORD: "` — press Enter to keep)
   - Add the variable name to `"variables"` array (e.g. `["EMAIL", "PASSWORD"]`)
   - Replace the literal value with `{{VAR_NAME}}` (e.g. `"value": "{{EMAIL}}"`)
5. Write the modified JSON back to the same file
6. If no variables are needed → `"variables": []` stays empty, no edit needed

**Variable naming rules:**
- Use UPPER_SNAKE_CASE: `EMAIL`, `PASSWORD`, `USERNAME`, `FULL_NAME`
- Use descriptive names that match the plan from step 3
- Use the names from the plan — don't invent new ones

**Example with function match:**
Before:
```json
{"variables": [], "defaults": {}, "tools": [{"tool": "fill", "args": {"selector": "#email", "value": "alice@test.com"}}]}
```
After:
```json
{"variables": ["EMAIL"], "defaults": {"EMAIL": "{{random_email()}}"}, "tools": [{"tool": "fill", "args": {"selector": "#email", "value": "{{EMAIL}}"}}]}
```

**Example with no function match (user provides literal):**
```json
{"variables": ["PASSWORD"], "defaults": {"PASSWORD": "custom_password"}, "tools": [{"tool": "fill", "args": {"selector": "#password", "value": "{{PASSWORD}}"}}]}
```

**Proceed to 5c only after variables are marked.**

## 5c. Replay and Validate (MANDATORY)

**After inspection passes, replay the recording to verify it works BEFORE registering.**

1. Read [references/supporting/replay_flow.md](references/supporting/replay_flow.md)
2. Perform replay — `replay_specific(wiki_root, module, export=True)`
3. **If replay fails:**
   - Fix the recording file (update the JSON)
   - Replay again until it passes
4. **If replay succeeds → register the recording (5d)**

**Do NOT skip this step. Validate before registering.**

## 5d. Register Recording (Optional)

After replay succeeds, ask the user: "Want to register this recording?"

- If yes → call `register_recording(wiki_root, module_name, recording_path, type, deps, name="[clean_name]", goal="[goal]", description="[description]", success_conditions=[...])`
  - **Always pass `name`** to avoid UUID suffixes in the recording name (e.g. `name="login-flow"`, not `"login-flow_d41ad15d"`)
  - **Agent generates `goal`** based on what was recorded:
    - Analyze the events: what page did it end on? What was the last action?
    - Goal should be a single sentence: "Complete associate hire wizard", "Navigate to employees list", etc.
    - If unsure, ask the user: "What's the goal of this recording?"
  - **Agent generates `description`** explaining what the recording does and what it excludes:
    - Include any incidental steps that were excluded (e.g. "Excludes transient profile completion modal")
    - Mention any special conditions (e.g. "Requires login session")
    - If unsure, ask the user: "What should be excluded from this recording?"
  - **Agent auto-generates `success_conditions`** from the recording events:
    - **Final URL**: Extract from the last navigation event (e.g. `{"type": "url", "value": "/employees"}`)
    - **Step count**: Count total events (e.g. `{"type": "step_count", "value": 22}`)
    - **Key elements**: Extract selectors from key interactions (e.g. `{"type": "element_exists", "selector": ".hire-modal"}`)
    - **No errors**: Always add `{"type": "no_errors", "description": "No replay errors"}`
    - Present to user: "Success conditions: [list]. Correct?"
  - **Agent infers module from context:**
    - Login → `module="auth"`
    - Employees → `module="hr"`
    - Billing → `module="billing"`
    - etc.
  - **Agent uses `deps` from step 1** (gathered during automation details):
    - If the user specified dependencies in step 1 → use those
    - If no dependencies → `deps=[]`
  - **Important:** Use module names OR recording names as deps — only ones that exist in the manifest. The tool resolves module names to all recordings in that module automatically.
- If no → skip

**Important:** The `goal`, `description`, and `success_conditions` are required fields. The agent MUST generate them before calling `register_recording`. If the user wants to skip registration, they say "no" — the recording is still saved to disk but not registered in the manifest.

Wait for user confirmation before proceeding.

## 5e. Session Close — MANDATORY

**After `stop_recording()` succeeds, you MUST close the session.** This prevents state leakage and frees browser resources.

Call `session_close(session_id=...)`.

## 5f. Update Wiki

After `stop_recording()` succeeds, update the automation wiki:

1. Add row to `automation-wiki/index.md` (preserve existing rows, append new one).
2. Update "Quick Stats" counts (recount from the table, don't hardcode).
3. Add a row to "Recent Activity".
4. Update `walkthrough.md`: fill in Recording Type (`auto` or `human`), Recording path, Run Log entry.

For the full wiki rules, templates, and status values, read [references/step_1_wiki_check.md](references/step_1_wiki_check.md).

## Recovery (Any Violation → Discard)

**Any violation → `stop_recording(session_id=...)` → discards recording, no JSON saved.**

Session violation, code-first violation, or any other violation: same action. The recording is thrown away, not saved to disk.

For more on recovery, read [references/supporting/replay_flow.md](references/supporting/replay_flow.md).