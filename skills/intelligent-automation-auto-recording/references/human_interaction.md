# Human Interaction (Optional Add-On)

This is an optional add-on flow for recording real user browser interactions **alongside** the mandatory auto recording. Use this when the user wants to also capture their own behavior (clicks, fills, scrolls) in addition to the agent's tool calls.

## When to Use

- The user explicitly asks to also record their own interactions
- You want to capture real user behavior alongside agent actions
- The user wants to document both agent and manual steps
- Auto recording is already happening (mandatory) — this is an extra layer

## How It Works

Human recording captures DOM events (click, fill, keydown, drag, scroll) via an injected script. When recording stops, events are automatically converted to the same auto-format JSON that `stop_recording()` produces — a structured `{tools: [{tool, args}]}` array.

**No raw DOM events file is saved.** The converted recording is identical in format to an auto recording and can be replayed and registered the same way.

## Flow

```
agent: session_start(...)
agent: replay_automation(recording_path="login_xxx.json")  ← set session state if needed
user: "start human recording"
agent: start_human_recording(session_id=..., recording_name="{name}")
agent: [watches — user interacts with browser]
user: "done"
agent: stop_human_recording(session_id)
      → converts events → saves automations/{name}_{uuid}.json
agent: curate the converted recording
agent: replay_specific / register_recording(..., type="auto", deps=[...])
agent: session_close(...)
agent: update wiki
```

## Steps

### 1. Start Session

```
session_start(base_dir=Path.cwd() / "automation-wiki" / "{name}")
```

### 2. Replay Dependencies (if needed)

If this recording depends on another recording (e.g., login):

```
replay_automation(recording_path="{dep_path}", session_id=current_session)
snapshot()  ← verify state
```

### 3. Start Human Recording

```
start_human_recording(session_id=..., recording_name="{name}")
```

The recorder is now active. The user can interact with the browser naturally.

### 4. Let User Interact

The agent watches but does NOT call `record_step`. The user:
- Clicks elements
- Fills forms
- Navigates between pages
- Uses mouse and keyboard naturally

The `RECORDER_JS` script (injected into the page) captures all DOM events automatically.

**Recording tips for the user:**
- Fill fields directly (don't press Enter between fields — it may submit the form)
- Click submit buttons instead of pressing Enter
- Avoid clicking around nav, toggles, or other UI elements not part of the automation
- Stay on-task — noise interactions get converted too

**Agent can:**
- Take snapshots/screenshots for evidence
- Answer user questions
- Guide the user if they get stuck

**Agent cannot:**
- Call MCP tools that modify the recording

### 5. Stop Recording

When the user is done:

**STOP gate:** Ask the user: "Is the interaction complete? Should I stop recording?"

Wait for explicit confirmation, then:

```
stop_human_recording(session_id=...)
```

The events are converted to auto-format and saved to:
```
{base_dir}/automations/{recording_name}_{uuid}.json
```

This is a structured recording identical to what `stop_recording()` produces.

### 6. Inspect and Curate

Read the converted recording file. Verify:
- All meaningful steps are present
- Redundant steps are removed
- Selectors are correct
- Transient UI steps are marked `optional=true` if needed

See [references/supporting/recording_format.md](references/supporting/recording_format.md) for Optional vs Compulsory rules.

### 7. Replay and Validate (MANDATORY)

Before registering, replay to verify the recording works:

```
replay_specific(wiki_root=..., recordings=["{recording_name}"])
```

If replay fails → fix the recording JSON → replay again until it passes.

### 8. Register Recording

After replay succeeds, call `register_recording()`:

```
register_recording(
    wiki_root=...,
    module_name="...",
    recording_path="{base_dir}/automations/{recording_name}_{uuid}.json",
    type="auto",          ← same as auto recording, NOT "human"
    deps=["{dep_name}"],  ← dependencies if any
    name="{clean_name}",
    goal="...",
    description="...",
    success_conditions=[...]
)
```

**Important:** The converted recording is `type="auto"` — same format as `stop_recording()`. The registration is identical to auto recording.

### 9. Close Session

```
session_close(session_id=...)
```

### 10. Update Wiki

Update `automation-wiki/{name}/walkthrough.md`:
- **Recording Type:** `human`
- **Path:** `automations/{recording_name}_{uuid}.json`
- **Variables:** (if any)
- **Run Log:** Add entry

## Differences from Auto Recording

| | Auto Recording | Human Interaction |
|---|---|---|
| Trigger | Agent calls `start_recording()` | User calls `start_human_recording()` |
| Source of steps | Agent's MCP tool calls | User's real browser interactions |
| Conversion | N/A (already structured) | DOM events → auto-format JSON |
| `type` in manifest | `"auto"` | `"auto"` (same format after conversion) |
| Output path | `automations/*.json` | `automations/*.json` (same path) |
| Replay | `replay_automation()` | `replay_automation()` (same tool) |
| Registration | `register_recording(type="auto")` | `register_recording(type="auto")` (same) |

## What Gets Recorded

The recorder captures DOM events:
- `click` — mouse clicks
- `fill` — input/select/textarea value changes (via `change` event)
- `keydown` — Enter, Tab, Escape keys
- `drag` — mouse drag operations
- `dblclick` — double clicks
- `contextmenu` — right clicks
- `scroll` — scroll events (debounced)

Each event includes:
- Timestamp, URL, element selector, tag, id, classes, text, rect
- Value for fill events, key for keydown events

## Conversion (Automatic)

`stop_human_recording()` calls `translate_events()` which:
- Maps event types to MCP tool names (`fill` → `fill`, `click` → `click`, `keydown(Enter)` → `press_key`)
- Upgrades selectors: id > name > text-based > class > positional
- Skips redundant clicks before fills
- Skips duplicate clicks within 1 second
- Skips dblclick after click on same element
- Inserts `navigate` when URL changes
- Extracts `{{EMAIL}}`/`{{PASSWORD}}` placeholders

## Session Violation Recovery

**Any violation → `stop_human_recording(session_id=...)` → recording discarded.**
