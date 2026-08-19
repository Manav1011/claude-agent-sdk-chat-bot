# Step 6: Validate Recording (Optional)

After `register_recording()` succeeds, the agent validates the recording by replaying it in a fresh session. If any step fails, the agent inspects the issue and fixes the recording file directly.

## When to Run

After `register_recording()` succeeds. Ask the user: "Validate the recording now?"

- If yes → follow this workflow
- If no → skip, proceed to close conversation

## Workflow Overview

```
1. Start fresh browser session
2. Replay dependencies first (using replay_automation)
3. Replay target recording step-by-step
4. If any step fails → fix recording file, retry
5. After all steps pass → mark recording as validated
```

## Step 1: Start Fresh Session

```python
session_start(base_dir=Path.cwd() / "automation-wiki" / "{name}")
```

**Why fresh session**: No state leakage from previous recordings. Consistent validation.

## Step 2: Replay Dependencies

For each dependency in `recording.metadata.deps`:

1. Call `replay_automation(automation_path=dep_path, session_id=current_session)`
2. Check if replay succeeded (no errors)
3. If dependency fails → report error, stop validation
4. If dependency succeeds → continue to target recording

**Note**: Dependencies run in the SAME session. This tests the real-world flow (A → B in same session).

## Step 3: Replay Target Recording Step-by-Step

Read the recording file to get the events array:

```python
import json
with open(recording_path) as f:
    recording = json.load(f)
events = recording.get("events", [])
```

For each event in `events`:

1. **Extract step details**:
   - `tool`: The MCP tool name (e.g., "navigate", "click", "fill")
   - `args`: The arguments (selector, value, url, etc.)

2. **Execute the step**:
   - Call the appropriate MCP tool with the extracted args
   - Example: `click(selector=args["selector"])`
   - Example: `fill(selector=args["selector"], text=args["value"])`

3. **Check if step succeeded**:
   - If no error → move to next step
   - If error → proceed to Step 4 (Fix)

## Step 4: Fix Recording on Failure

When a step fails, the agent modifies the recording file directly:

### Fix Type 1: Mark Step as Optional

If the step targets a transient UI element (modal, banner, consent prompt):

```python
# Read recording
with open(recording_path) as f:
    recording = json.load(f)

# Find the failed step and mark as optional
for i, event in enumerate(recording["events"]):
    if i == failed_step_index:
        if "optional" not in event.get("args", {}):
            event["args"]["optional"] = True
        break

# Write back
with open(recording_path, "w") as f:
    json.dump(recording, f, indent=2)
```

**When to use**: Element doesn't exist, but the step might be needed in other sessions.

### Fix Type 2: Remove Step Entirely

If the step is incidental (not part of the goal):

```python
# Read recording
with open(recording_path) as f:
    recording = json.load(f)

# Remove the failed step
recording["events"] = [e for i, e in enumerate(recording["events"]) if i != failed_step_index]

# Write back
with open(recording_path, "w") as f:
    json.dump(recording, f, indent=2)
```

**When to use**: Step is not in success conditions, or description says "excludes transient modals".

### Fix Type 3: Add Wait Before Step

If the step times out waiting for an element:

```python
# Read recording
with open(recording_path) as f:
    recording = json.load(f)

# Insert a wait_for_selector step before the failed step
wait_step = {
    "tool": "wait_for_selector",
    "args": {
        "selector": failed_step_args.get("selector", ""),
        "timeout": 5000,
        "session_id": current_session
    }
}
recording["events"].insert(failed_step_index, wait_step)

# Write back
with open(recording_path, "w") as f:
    json.dump(recording, f, indent=2)
```

**When to use**: Element exists but takes time to appear.

### Decision Logic

```
If step fails:
  If selector targets transient UI (modal, banner, "Cancel", "Ignore", "Dismiss"):
    → Fix Type 1 (mark optional)
  Elif step not in success conditions:
    → Fix Type 2 (remove step)
  Elif error is timeout:
    → Fix Type 3 (add wait)
  Else:
    → Report to user (manual intervention needed)
```

### After Fix

1. Retry the fixed step
2. If retry succeeds → move to next step
3. If retry fails → try next fix type, or report to user

**Max fix attempts**: 3 per step. If still failing after 3 attempts, report to user.

## Step 5: Mark as Validated

After all steps pass:

1. Update manifest: set `validation_status = "validated"`
2. Update `validated_at` timestamp
3. Report success to user

## Example: Full Validation Flow

```
Recording: "hire-associate"
Dependencies: ["login"]
Success conditions:
  - url: /employees
  - step_count: 22
  - no_errors

1. session_start()
2. replay_automation("login") → success
3. Replay "hire-associate" step-by-step:
   - Step 1-5: Login steps → success
   - Step 6: click('button:has-text("Ignore Prompt")') → FAIL (element not found)
   - Fix: Mark step 6 as optional
   - Retry step 6 → success (skipped)
   - Step 7-22: Wizard steps → success
4. Update manifest: validation_status = "validated"
```

## Error Handling

| Error | Action |
|-------|--------|
| Step fails 3 times | Report to user, stop validation |
| Manifest update fails | Log error, continue (validation still passed) |
| Recording file unreadable | Report to user, stop validation |

## When NOT to Auto-Fix

- Changing selectors (might break for other users)
- Adding new steps (semantic change)
- Removing essential steps (might break flow)

**Rule**: Only fix mechanical issues (mark optional, add wait, remove incidental steps). Semantic changes require user input.