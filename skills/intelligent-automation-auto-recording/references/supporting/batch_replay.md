# Batch Replay

## Overview

Run multiple recordings from `manifest.json` in dependency-resolved order with fresh browser sessions. This is a **standalone feature** — not part of the 5-step skill chain.

## When to Use

- User says "run all recordings"
- User says "replay the automation"
- User says "run the auth module"
- User wants to verify multiple recordings at once

## Tool Signature

```python
@tool
async def batch_replay(
    wiki_root: str,
    module: str | None = None,
    recordings: list[str] | None = None,
    export: bool = False,
) -> dict:
```

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `wiki_root` | Yes | Path to the automation-wiki folder (e.g. `automation-wiki/login`) |
| `module` | No | Filter by module name (e.g. `"auth"`, `"hr"`) |
| `recordings` | No | Filter by recording names (e.g. `["login-flow", "employees"]`) |
| `export` | No | If True, generates HTML report at `reports/report-{timestamp}.html` |

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `wiki_root` | Yes | Path to the automation-wiki folder (e.g. `automation-wiki/login`) |
| `module` | No | Filter by module name (e.g. `"auth"`, `"hr"`) |
| `recordings` | No | Filter by recording names (e.g. `["login-flow", "employees"]`) |

### Returns

Report dict with:
- `timestamp`: When the batch ran
- `total`: Total recordings
- `passed`: Recordings that completed successfully
- `failed`: Recordings where at least one step/event failed
- `skipped`: Recordings skipped because a dependency failed
- `duration_seconds`: Total time for batch
- `modules`: Per-module pass/fail/skip counts
- `execution_plan`: Which recordings ran in which round
- `details`: Per-recording details with `failed_events`

## Execution Flow

1. **Read manifest** — Load `manifest.json` from `wiki_root`
2. **Filter** — Apply `module` and `recordings` filters if specified
3. **Topological sort** — Group recordings into rounds based on dependencies:
   - Round 1: Recordings with no deps
   - Round 2: Recordings whose deps are all in Round 1
   - Round 3: Recordings whose deps are all in Round 2
   - etc.
4. **Execute rounds** — For each round:
   - For each recording in round:
     - Call `replay_automation()` for all recordings (all are auto-format)
     - The replay functions create fresh browser sessions internally
     - Capture duration, pass/fail, details
5. **Handle failures** — If recording A fails:
   - Mark A as `"failed"`
   - All recordings that depend on A become `"skipped"`
6. **Write results** — Save `last_run_results` to `manifest.json`
7. **Return report**

## Report Schema

```json
{
  "timestamp": "2026-07-14T12:00:00Z",
  "total": 5,
  "passed": 4,
  "failed": 1,
  "skipped": 1,
  "duration_seconds": 120,
  "modules": {
    "auth": {"passed": 2, "failed": 0, "skipped": 0},
    "hr": {"passed": 2, "failed": 1, "skipped": 1}
  },
  "execution_plan": [
    {"round": 1, "recordings": ["login-flow", "logout"], "duration": 10},
    {"round": 2, "recordings": ["employees"], "duration": 15}
  ],
  "details": [
    {
      "name": "login-flow",
      "module": "auth",
      "status": "passed",
      "round": 1,
      "duration_seconds": 5,
      "steps_total": 4,
      "steps_successful": 4,
      "steps_failed": 0,
      "failed_events": null
    },
    {
      "name": "employees",
      "module": "hr",
      "status": "failed",
      "round": 2,
      "duration_seconds": 15,
      "steps_total": 8,
      "steps_successful": 7,
      "steps_failed": 1,
      "failed_events": [
        {
          "event_index": 6,
          "event_type": "click",
          "error": "Selector not found: .employee-list"
        }
      ]
    },
    {
      "name": "payroll",
      "module": "hr",
      "status": "skipped",
      "round": null,
      "duration_seconds": 0,
      "steps_total": 0,
      "steps_successful": 0,
      "steps_failed": 0,
      "failed_events": null
    }
  ]
}
```

## `failed_events`

For failed recordings, `failed_events` captures which step failed:

```json
{
  "step_index": 6,
  "tool": "click",
  "args": {"selector": ".employee-list"},
  "error": "Selector not found"
}
```

- `step_index`: 0-indexed position in the tools array
- `tool`: The MCP tool name that failed
- `error`: Error message from Playwright

## Examples

```python
# Run all recordings
batch_replay(wiki_root="/path/to/automation-wiki/login")

# Run only auth module
batch_replay(wiki_root="/path/to/automation-wiki/login", module="auth")

# Run specific recordings
batch_replay(wiki_root="/path/to/automation-wiki/login", recordings=["login-flow", "employees"])
```

## Manifest Structure

Recordings are stored in `manifest.json`:

```json
{
  "name": "login-automation",
  "created_at": "2026-07-14T10:00:00Z",
  "modules": {
    "auth": {
      "label": "Authentication",
      "recordings": [
        {
          "name": "login-flow",
          "path": "recordings/login-flow_xxx.json",
          "type": "auto",
          "deps": [],
          "module": "auth",
          "created_at": "2026-07-14T10:05:00Z"
        }
      ]
    }
  },
  "last_run_results": null
}
```

## Key Points

- **Fresh browser per recording** — No state leakage between recordings
- **Dependencies respected** — Deps run first, failed deps skip dependents
- **Parallel within rounds** — Recordings in the same round run concurrently
- **Manifest updated** — `last_run_results` written after each batch
- **Human recording detail** — `failed_events` captures which DOM event failed

---

## Standalone Batch Replay

`batch_replay_standalone` runs all selected recordings in a **single browser session** without replaying dependencies. Use this when you want recordings to share state (cookies, storage) or when you want faster execution.

## Tool Signature

```python
@tool
async def batch_replay_standalone(
    wiki_root: str,
    module: str | None = None,
    recordings: list[str] | None = None,
    export: bool = True,
) -> dict:
```

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `wiki_root` | Yes | Path to the automation-wiki folder (e.g. `automation-wiki/login`) |
| `module` | No | Filter by module name (e.g. `"auth"`, `"hr"`) |
| `recordings` | No | Filter by recording names (e.g. `["login-flow", "employees"]`) |
| `export` | No | If True, generates HTML report at `reports/standalone-report-{timestamp}.html` (default) |

### Returns

Same report schema as `batch_replay` (total/passed/failed/skipped/modules/execution_plan/details).

## Execution Flow

1. **Read manifest** — Load `manifest.json` from `wiki_root`
2. **Filter** — Apply `module` and `recordings` filters if specified
3. **Topological sort** — Order recordings by dependencies (deps first, but not replayed)
4. **Create single session** — One browser session for all recordings
5. **Execute sequentially** — For each recording in order:
   - Call `replay_automation` or `replay_interactions` directly
   - If recording fails, add to `failed_names` set
   - If any dependency failed, skip this recording
6. **Close session** — Single close call for the entire batch
7. **Write results** — Save `last_run_results` to `manifest.json`
8. **Return report**

## Key Differences from `batch_replay`

| Aspect | `batch_replay` | `batch_replay_standalone` |
|---|---|---|
| Sessions | Fresh per recording | One shared session |
| Dependencies | Replayed in same session | Not replayed (ordering only) |
| Execution | Round-based (parallel within rounds) | Linear (sequential) |
| HTML filename | `report-{timestamp}.html` | `standalone-report-{timestamp}.html` |
| `deps_executed` | Lists actually replayed deps | Always `["—"]` |

## When to Choose Standalone

- **Faster execution** — No per-recording session setup/teardown overhead
- **Shared state testing** — Verify recordings work when they share a session (cookies, storage)
- **Independent testing** — Test each recording without relying on dep execution
- **Simpler debugging** — Single session means single set of console errors/network logs

## When NOT to Use Standalone

- You need to verify recordings work with fresh state (use `batch_replay`)
- You need to test the actual dependency flow (use `batch_replay`)
- Recordings depend on side effects from previous recordings that aren't captured in the manifest (use `batch_replay`)

## Examples

```python
# Run all recordings in one session
batch_replay_standalone(wiki_root="/path/to/automation-wiki")

# Run only auth module
batch_replay_standalone(wiki_root="/path/to/automation-wiki", module="auth")

# Run specific recordings
batch_replay_standalone(wiki_root="/path/to/automation-wiki", recordings=["login-flow", "employees"])

# Run with HTML report
batch_replay_standalone(wiki_root="/path/to/automation-wiki", export=True)
```