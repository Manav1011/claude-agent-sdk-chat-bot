# Replay Flow & Recovery

## Replay

After `stop_recording()` succeeds, the agent replays the recording to verify it works.

- **Auto recording:** `replay_automation(automation_path=...)`
- **Human recording:** `replay_interactions(interactions_path=..., base_url=...)`

### Auto Recording (Structured Tool Calls)

Used when `start_recording` / `record_step` / `stop_recording` was used. The recorded JSON is structured as `{tools: [{tool, args}]}`.

**Without variables (exact values, no substitution):**
```
replay_automation(
  automation_path="automation-wiki/{name}/automations/recordings/{filename}.json",
  session_id="sess_xxx"
)
```

**With variables ({{VAR}} placeholders replaced):**
```
replay_automation(
  automation_path="automation-wiki/{name}/automations/recordings/{filename}.json",
  session_id="sess_xxx",
  values={"EMAIL": "new@test.com", "PASSWORD": "newpass"}
)
```

When `values` is provided and the recording has `"variables": [...]`, `{{VAR}}` placeholders are substituted before replay. If `values` is omitted, `"defaults"` from the recording are used as fallback.

**Smart function resolution:** Default values can contain function calls like `{{random_email()}}` or `{{current_date("YYYY-MM-DD")}}`. These are resolved at replay time before variable substitution. Each function call returns a fresh value (e.g., `random_email()` generates a new random email each time). The browser never sees the `{{fn(...)}}` pattern.

**Resolution order:** `values` → `defaults` (with functions resolved) → `{{VAR}}` placeholder stays as-is.

### Human Recording (Raw DOM Events)

Used when `start_human_recording` / `stop_human_recording` was used. The recorded JSON is a flat array of DOM events (`click`, `fill`, `scroll`, etc.).

```
replay_interactions(
  input_path="automation-wiki/{name}/automations/recordings/{filename}.json",
  session_id=...,
  base_url="https://example.com"
)
```

## Recovery (Any Violation → Discard)

**Any violation → `stop_recording(session_id=...)` → discards recording, no JSON saved.**

Session violation, code-first violation, or any other violation: same action. The recording is thrown away, not saved to disk. This prevents corrupted or incomplete recordings from being used in production.

### What Counts as a Violation

- Attempting to use a selector without first reading code or running graphify (for internal pages)
- Calling tools without a plan approval
- Missing `base_dir` on `session_start`
- Recording failed steps
- Any other rule violation from this skill

When a violation occurs:
1. Stop recording immediately.
2. Log the failure.
3. Take snapshot/screenshot for evidence.
4. The recording file is NOT written to disk.
5. The session is still closed normally.