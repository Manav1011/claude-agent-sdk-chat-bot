# Session Setup

## session_start

`session_start` is a required step. All parameters:

- `base_dir` — **Required keyword argument.** No `base_dir` = don't call `session_start`. Pass `Path.cwd() / "automation-wiki" / "{normalized-name}"` so all files (recordings, screenshots, snapshots) are saved to that automation's folder.
- `email` — The user's email address (only used for launch/persistent sessions to maintain uniqueness).
- `profile_name` — Optional Chrome profile name (stored under profiles/).

## Base Directory

Each automation has its own folder under `automation-wiki/`. Pass `base_dir=Path.cwd() / "automation-wiki" / "{normalized-name}"` to `session_start()` so all files (recordings, screenshots, snapshots) are saved to that automation's folder. This keeps every automation self-contained.

## Session Lifecycle

Session lifecycle follows the automation flow:
1. `session_start` → 2. `start_recording` → 3. execute → 4. `stop_recording` → 5. `session_close`

## Mandatory Rules

**Rule 1: Always present a plan before any tool calls.** — Not after. Not "I'll figure it out as I go." Present the plan, wait for "yes"/"go"/"start", then only then call tools. (See [references/step_3_plan.md](../step_3_plan.md))

**Rule 2: Always pass `base_dir` to `session_start`.** — It is a required keyword argument. No `base_dir` = don't call `session_start`.