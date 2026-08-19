# Recording Format

## record_step Signature

```
record_step(session_id=..., tool_name=..., args={...}, optional=false)
```

- `session_id`: The browser session ID
- `tool_name`: The MCP tool name that was just called (e.g. `"navigate"`, `"fill"`, `"click"`)
- `args`: The arguments passed to the tool, as a flat dict. Include `session_id` inside this dict if the tool requires it.
- `optional`: Set to `true` when the target element only appears sometimes (transient UI). During replay, if the element doesn't exist, the step is skipped silently instead of failing.

**No `recording_name` parameter.** `recording_name` is only for `start_recording()`, not `record_step()`.

## Optional Steps

An optional step handles transient UI elements (modals, banners, consent prompts, popups) that may or may not appear during replay.

**Mark as optional:** When the element is *conditional* — it appears only in certain states and doesn't exist in all sessions.
**Mark as compulsory:** When the element is *essential* — it must exist for the automation to proceed.

Example:
```
# Compulsory — login form, must always be present
record_step(session_id=..., tool_name="fill", args={"selector": "#email", "value": "user@example.com"})

# Optional — profile completion modal, only appears on first login
record_step(session_id=..., tool_name="click", args={"selector": 'button:has-text("Ignore Prompt")'}, optional=true)
```

During replay:
- Compulsory step with missing element → **fail** (the automation cannot proceed)
- Optional step with missing element → **skip silently** (the step is not needed)
- Optional step with present element → **execute normally**

## Stop Recording Output

On `stop_recording()`:
- The recorded JSON stores **exact values** as recorded — no placeholder substitution.
- A `"variables": []` array and `"defaults": {}` object are included — the AI agent edits these after recording to mark which args should be substituted at replay time.

The recorded file is a structured JSON:
```json
{
  "version": 1,
  "name": "login-flow",
  "tools": [
    { "tool": "navigate", "args": { "url": "https://example.com" } },
    { "tool": "fill", "args": { "selector": "#email", "value": "user@example.com" } },
    { "tool": "fill", "args": { "selector": "#password", "value": "secret123" } }
  ],
  "variables": [],
  "defaults": {}
}
```

### Variables

After recording, the AI agent may edit the JSON to mark dynamic fields:

- Add variable names to the `"variables"` array (e.g. `["EMAIL", "PASSWORD"]`)
- Replace the literal value in the corresponding `fill`/`navigate` step with `{{VAR_NAME}}`
- Add default values in `"defaults"` — either literal strings or smart function calls

**Literal defaults:**
```json
{"variables": ["PASSWORD"], "defaults": {"PASSWORD": "custom_password"}}
```

**Smart function defaults** (resolved at replay time):
```json
{"variables": ["EMAIL"], "defaults": {"EMAIL": "{{random_email()}}"}}
{"variables": ["DOB"], "defaults": {"DOB": "{{current_date(\"YYYY-MM-DD\")}}"}}
{"variables": ["AGE"], "defaults": {"AGE": "{{random_int(18, 65)}}"}}
```

Available smart functions: `current_date`, `current_timestamp`, `next_day`, `previous_day`, `start_of_week`, `end_of_week`, `random_int`, `random_string`, `random_email`, `random_phone`.

Example after marking:
```json
{
  "variables": ["EMAIL", "PASSWORD"],
  "defaults": {"EMAIL": "{{random_email()}}", "PASSWORD": "custom_password"},
  "tools": [
    { "tool": "fill", "args": { "selector": "#email", "value": "{{EMAIL}}" } },
    { "tool": "fill", "args": { "selector": "#password", "value": "{{PASSWORD}}" } }
  ]
}
```

### Replay with variables

```
replay_automation(
  automation_path="path/to/recording.json",
  session_id="sess_xxx",
  values={"EMAIL": "new@test.com", "PASSWORD": "newpass"}
)
```

**Resolution order:**
1. `values` (user-provided, highest priority)
2. `defaults` (resolved at replay time)
3. `{{VAR}}` placeholder stays as-is if not resolved

Smart function calls in defaults are resolved **before** variable substitution. Each call to `random_email()` returns a different value. The browser never sees the `{{fn(...)}}` pattern — it receives the resolved string.

## Filename

Recording filenames: `{name}_{8-char-uuid}.json`

If two recordings collide (same UUID), append the timestamp: `{name}_{uuid}_{timestamp}.json`. This is extremely rare — the 8-char UUID is almost always sufficient.

## Registration Metadata

When registering a recording via `register_recording`, the following metadata is required:

### `goal` (string, required)

The automation goal — what the recording is supposed to achieve.

Examples:
- "Complete associate hire wizard"
- "Navigate to employees list and export data"
- "Login to application"

The agent generates this from analyzing the recording events (final URL, last action, context).

### `description` (string, required)

A description of what the recording does, including any exclusions or special conditions.

Examples:
- "Automates associate hire flow. Excludes transient profile completion modal."
- "Exports employee data. Requires login session."

### `success_conditions` (list of objects, auto-generated)

Structured conditions the replay engine checks to verify the recording succeeded. Each condition has:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Condition type (see table below) |
| `value` | varies | Expected value (URL, count, selector, etc.) |
| `selector` | string | CSS selector for element-based checks |
| `description` | string | Human-readable description of the check |

**Supported condition types:**

| Type | Description | Example |
|------|-------------|---------|
| `url` | Final URL matches exactly | `{"type": "url", "value": "/employees"}` |
| `url_contains` | URL contains substring | `{"type": "url_contains", "value": "/employees/123"}` |
| `element_exists` | Element is present in DOM | `{"type": "element_exists", "selector": ".confirm-modal"}` |
| `element_text` | Element contains expected text | `{"type": "element_text", "selector": ".status", "value": "Success"}` |
| `step_count` | Total steps executed | `{"type": "step_count", "value": 22}` |
| `no_errors` | No replay errors occurred | `{"type": "no_errors", "description": "No errors"}` |
| `custom` | AI-evaluated (manual check) | `{"type": "custom", "description": "Wizard completed"}` |

**Agent auto-generates these from recording events:**
- **Final URL**: Extract from last `navigate` event
- **Step count**: Count total events in recording
- **Key elements**: Extract selectors from `click`/`fill` events at key moments
- **No errors**: Always added as last condition

**Presentation to user:**
```
Success conditions:
- Final URL: /employees
- Steps executed: 22
- Hire modal present: .hire-modal
- No errors

Correct? (y/n)
```

### Example Registration Call

```python
register_recording(
    wiki_root="/path/to/automation-wiki",
    module_name="hr",
    recording_path="recordings/hire-associate_xxx.json",
    type="auto",
    deps=[],
    name="hire-associate",
    label="HR Module",
    goal="Complete associate hire wizard",
    description="Automates hire flow. Excludes transient modals.",
    success_conditions=[
        {"type": "url", "value": "/employees", "description": "Final page is employees list"},
        {"type": "step_count", "value": 22, "description": "All wizard steps executed"},
        {"type": "element_exists", "selector": ".hire-modal", "description": "Hire modal appeared"},
        {"type": "no_errors", "description": "No replay errors"}
    ]
)
```

## What Gets Auto-Logged

Action tools are automatically logged to the session log file:
- `navigate`, `click`, `fill`, `type`, `check`, `select_option`, `press_key`, `upload_file`

These are NOT auto-logged (do not need `record_step`):
- `snapshot`, `screenshot`, `list_tabs`, `console_messages`, `get_text`, `get_value`, `get_attribute`
- `assert_*`, `wait_for_*`, `session_*`, `start_recording`, `stop_recording`, `register_recording`
- `execute`, `fill_form`
- `replay_*`, `batch_replay_*`
- `record_step` itself
- `close_tab`, `switch_tab`, `new_tab`

The agent curates from the log by calling `record_step()` for each meaningful step, then `stop_recording()`.

## Human Recording (Alternative Path)

Human recording (`start_human_recording` / `stop_human_recording`) captures DOM events (click, fill, scroll, etc.) via an injected script. When `stop_human_recording()` is called, events are automatically converted to the same structured auto-format as `stop_recording()` — a `{tools: [{tool, args}]}` array. No raw DOM events file is saved.

The converted recording:
- Is identical in format to auto recording
- Is replayed via `replay_automation()` (not `replay_interactions()`)
- Is registered as `type="auto"` (same as auto recording)

See [references/human_interaction.md](../human_interaction.md) for the full flow.