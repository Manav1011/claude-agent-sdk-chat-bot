---
name: intelligent-automation-auto-recording
description: >
  Use when automating web interactions on pages that may be in your codebase or third-party, especially when navigation, form filling, or data extraction requires code-aware decision making. Triggers on: "do the login automation", "automate this flow", "record this interaction", "create an automation", "automate the signup", "automate the checkout", or any request to automate a multi-step web flow.
---

# Intelligent Automation

Automate web interactions by reading code first, using exact selectors from code, and falling back to snapshots only when direct clicks fail.

## How to Use This Skill

This skill is split into step files. **Read ONLY the current step's file before acting.** Do NOT read all step files upfront. Each step has a **STOP gate** at the end — you MUST ask the user something and wait for their response before moving to the next step. Follow the chain, one step at a time, always waiting for user confirmation.

**When you need to ask the user anything — a question, confirmation, options — use the `AskUserQuestion` tool.** Do NOT wait for the user to type and hit Enter. Do NOT say "let me know" and then sit idle. Use `AskUserQuestion` to prompt them and wait for their response. This applies to every STOP gate, every "ask user" step, and every decision point in the chain.

**Critical: Exploration session is READ-ONLY. Do NOT fill forms, submit, or log in during exploration. Exploration = verify selectors exist, take snapshots, check behavior with `get_attribute()` and `assert_*`. Recording = execute the flow with `fill()`, `click()`, `navigate()`. These are separate sessions. The exploration session must start and end in the same state.**

**Dependency handling: If an automation depends on other automations (e.g., login), replay the dependencies first in the session before exploring or recording the target automation. This ensures the session is in the correct state — you can't explore a dashboard if the session isn't logged in, and you can't record a flow that requires login if the session isn't logged in.**

**Recording approach: Two phases. Phase 1 (Step 4) = execute only. Action tools auto-log. Do NOT call `start_recording()`, `record_step()`, `list_log_entries()`, or `stop_recording()` during execution. Phase 2 (Step 5) = recording only. After execution is COMPLETE, read the log, curate meaningful steps with `record_step()`, then `stop_recording()`. This eliminates the #1 failure mode: "agent forgot to record."**

1. **Check wiki** — Read [references/step_1_wiki_check.md](references/step_1_wiki_check.md). Ask the user a question, wait for their answer, then follow its link to step 2.
2. **Discovery** — Read [references/step_2_discovery.md](references/step_2_discovery.md). **MANDATORY: Use graphify and read source code to discover all details before asking the user.** Only ask the user for things that can't be discovered (dummy data values, out-of-scope items, unclear scope). Wait for answers, then follow its link to step 3.
3. **Plan** — Read [references/step_3_plan.md](references/step_3_plan.md). Present the plan, wait for explicit approval, then follow its link to step 4.
4. **Execution** — Read [references/step_4_execution.md](references/step_4_execution.md). Replay dependencies first (if any), then execute the automation, ask the user if it's complete, wait for their answer.
5. **Recording** — Read [references/step_5_recording.md](references/step_5_recording.md). Stop recording → inspect recording for errors → ask user if they want to register in manifest → close session → update wiki → replay. This is the final step.
6. **Validation** — Read [references/step_6_validation.md](references/step_6_validation.md). Run validation in a fresh session: replay dependencies, then replay the recording step-by-step. If any step fails → fix the recording file and retry. **Validation is MANDATORY.** The automation is NOT done until validation passes. Report to user only after validation completes successfully.

Supporting reference files (read ONLY when the current step tells you to — do NOT read them all upfront):

| File | When to read |
|------|-------------|
| [references/supporting/selector_priority.md](references/supporting/selector_priority.md) | When you need to resolve a selector (step 4) |
| [references/supporting/wait_strategy.md](references/supporting/wait_strategy.md) | When you need to wait for navigation or content (step 4) |
| [references/supporting/recording_format.md](references/supporting/recording_format.md) | When you're about to call record_step or stop_recording (step 4/5) |
| [references/supporting/session_setup.md](references/supporting/session_setup.md) | When you need session_start details (step 4) |
| [references/supporting/replay_flow.md](references/supporting/replay_flow.md) | When you're about to replay or handle a violation (step 5) |
| [references/step_6_validation.md](references/step_6_validation.md) | When you want to validate a recording (step 6) |

**Start here — read [references/functionalities.md](references/functionalities.md) for the full philosophy, MCP server tool reference, key rules, decision trees, and how every piece connects.** This is the "why" behind the 5-step chain.

**For the human user — read [references/user_guide.md](references/user_guide.md).** This tells the user how to phrase requests, what to expect, and how to correct the agent.

**Before starting — read [references/prerequisites.md](references/prerequisites.md).** This tells you what's required to run the automation system (Python, MCP server, Playwright, Graphify, Chrome, target site).

Optional standalone flows (NOT part of the 5-step chain):

| File | When to read |
|------|-------------|
| [references/human_interaction.md](references/human_interaction.md) | Only if the user chooses human interaction during discovery |
| [references/supporting/batch_replay.md](references/supporting/batch_replay.md) | When user says "run all recordings", "run all in same session", "run the auth module", or "replay specific" |

## Selector Priority (MANDATORY — During Discovery)

During the Discovery phase, resolve selectors in this order before presenting the plan:

1. **Graphify** — query knowledge graph for component relationships (MANDATORY for internal pages)
2. **Read code** — find exact selectors (href, id, text) in source
3. **Playwright direct** — click/fill with code-derived selectors
4. **JS execute** — find selectors via DOM when code doesn't reveal them
5. **Snapshot** — analyze YAML to find selectors (last resort)
6. **Screenshot** — visual inspection (last resort, only when snapshot fails)

**Graphify is not optional for internal pages.**

> **MANDATORY: Always run `graphify query` / `graphify path` / `graphify explain` from the project root directory — the directory where `graphify-out/` exists.** Do NOT run graphify from any subdirectory, from the skill directory, or from `/tmp`. The agent MUST `cd` to the root directory first. Running from the wrong directory produces empty results and breaks discovery.

**During recording, use the selectors already verified in Discovery. Do not re-discover.** If a selector fails during recording → Error Protocol applies.

## Recording Rules (MUST FOLLOW — Every Recording)

### The code is the source of truth — always
Throughout the entire recording process, the code is authoritative:
- If the page doesn't match your expectations → read the code
- If something fails → read the code to understand why
- If something works but you don't know why → read the code
- Never guess about page behavior — verify with the code
- The code never lies; your assumptions about it can

### `execute()` is READ-ONLY — never use it to fill or click
`execute()` is for **DOM reads only**: computed styles, `window.__NEXT_DATA__`, `localStorage`, JSON from `<script>` tags. **Never use `execute()` to fill form fields, click buttons, or manipulate the page.** Use `fill()` or `click()` instead.

### Form fields: always use `fill(selector, value)` — arg name is `value`, NOT `text`
- Correct: `fill(selector="#email", value="test@example.com")`
- Wrong: `fill(selector="#email", text="test@example.com")` ← will fail during replay
- `type()` takes `text`, `fill()` takes `value`

### Modal/dialog dismiss steps: NEVER mark as optional
If a step dismisses a modal, it is **compulsory**. Marking it `optional: true` causes it to skip before the modal renders, blocking all subsequent steps silently.

---

## MCP Tools Reference

**Core:** `navigate()`, `click()`, `fill()`, `type()`, `check()`, `select_option()`, `execute()`
**Wait:** `wait_for_url()`, `wait_for_load_state()`, `wait_for_selector()`, `wait_for_navigation()`, `sleep()`
**Verify:** `snapshot()`, `screenshot()`, `assert_visible()`, `assert_text()`, `assert_title()`, `assert_url()`, `assert_no_console_errors()`
**State:** `get_text()`, `get_value()`, `get_attribute()`, `get_cookies()`, `get_local_storage()`, `set_cookies()`, `set_local_storage()`, `set_storage_state()`
**Session:** `session_start`, `session_close`, `session_list`, `list_log_entries`
**Recording:** `start_recording`, `record_step`, `stop_recording`, `start_human_recording`, `stop_human_recording`, `register_recording`
**Replay:** `replay_automation`, `replay_interactions`, `batch_replay_all`, `batch_replay_all_standalone_session`, `replay_specific`
**Other:** `press_key`, `fill_form`, `upload_file`, `console_messages()`, `clear_console_messages()`

## Quick Reference

| Scenario | Approach | Tools |
|----------|----------|-------|
| Start automation | Check wiki → Plan → Approve → `session_start(base_dir, exploration=False, headless=False)` → execute freely → wait_for_* as needed | `session_start()`, `navigate()`, `fill()`, `click()`, `wait_for_*` |
| Headless mode | Set `headless=True` in `session_start()` for CI/CD or server runs | `session_start()` |
| Multi-field form (any) | `fill()` per field — NEVER `execute()` for writing | `fill(selector, value)` |
| Batch JS reads only | `execute()` — reads only, never writes | `execute(script)` |
| Internal page | Graphify (if available) → Read code → click by href | `graphify`, `Read`, `click()`, `wait_for_url()` |
| Third-party | Navigate → fill → click | `navigate()`, `fill()`, `click()` |
| Click fails | list_tabs → execute → snapshot | `list_tabs()`, `execute()`, `snapshot()` |
| Auth0 callback | `wait_for_load_state("networkidle")` | `wait_for_load_state()` |
| Recording (Step 5 only) | Execution is COMPLETE → `list_log_entries()` → curate with `record_step()` → `stop_recording()` → register → `session_close()` | `list_log_entries()`, `record_step()`, `stop_recording()`, `register_recording()`, `session_close()` |
| Replay | Ask user → replay_automation or replay_interactions | `replay_automation()`, `replay_interactions()` |
| Read closed-session log | `list_log_entries()` — works even after `session_close()` (registry fallback) | `list_log_entries()` |
| Batch replay (all) | `batch_replay_all(wiki_root, export=True)` — runs ALL recordings, fresh sessions | `batch_replay_all()` |
| Batch replay (standalone) | `batch_replay_all_standalone_session(wiki_root, export=True)` — runs ALL in ONE session | `batch_replay_all_standalone_session()` |
| Replay specific | `replay_specific(wiki_root, module?, recordings?, export=True)` — runs specific module/recordings WITH deps | `replay_specific()` |

---

## Optional: Human Interaction (Add-On)

Auto recording is **mandatory** — it's part of the main 5-step chain. The agent executes freely (action tools auto-log), then curates steps from the log (`list_log_entries()` → `record_step()` for each curated step → `stop_recording()`).

If the user also wants to record their own browser interactions (clicks, fills, scrolls) as an add-on, follow the separate guide: **[references/human_interaction.md](references/human_interaction.md)**

Human interaction is an optional extra — it runs alongside auto recording, not instead of it.

## Optional: Batch Replay

Batch replay is an optional standalone feature for running multiple recordings in dependency-resolved order.

**When to use:**
- User says "run all recordings" → `batch_replay_all()`
- User says "run all in same session" → `batch_replay_all_standalone_session()`
- User says "run the auth module" → `replay_specific(module="auth")`

**Not part of the 5-step chain** — user invokes it directly.

**Flow:**
1. Call `batch_replay_all(wiki_root, export=True)`
2. Returns report with pass/fail/skip counts and `failed_events`

**For details, read [references/supporting/batch_replay.md](references/supporting/batch_replay.md).**

Batch replay executes recordings with:
- Fresh browser per recording (no state leakage)
- Dependency resolution (deps run first)
- Round-based execution
- Skip dependents if dependency fails

### Optional: Standalone Batch Replay

`batch_replay_all_standalone_session` runs all recordings in a **single browser session** without replaying dependencies.

**When to use:**
- User says "run all in same session"
- User wants faster batch replay (no per-recording session setup/teardown)
- User wants to verify recordings work in a shared context

**Not part of the 5-step chain** — user invokes it directly.

**Flow:**
1. Call `batch_replay_all_standalone_session(wiki_root, export=True)`
2. Topological sort determines execution order (deps run first as heuristic, not replayed)
3. Single browser session handles all recordings
4. If a recording fails, dependents are skipped
5. Returns report with pass/fail/skip counts

**Key differences from `batch_replay_all`:**
- One session for all recordings (vs fresh per recording)
- No dependency replay (vs deps run first in same session)
- Linear execution (vs round-based)

**For details, read [references/supporting/batch_replay.md](references/supporting/batch_replay.md).**

### Optional: Replay Specific Module

`replay_specific` runs a specific module with its dependencies replayed.

**When to use:**
- User says "run the auth module"
- User wants to test a module with its dependencies

**Not part of the 5-step chain** — user invokes it directly.

**Flow:**
1. Call `replay_specific(wiki_root, module="auth", export=True)`
2. Collects all recordings in that module + their dependencies (from all modules)
3. Topological sort determines execution order
4. ONE browser session
5. Each recording replays its dependencies first in the same session
6. Returns report with pass/fail/skip counts

**Key differences from `batch_replay_all`:**
- Runs a specific module (not all)
- Dependencies are replayed in the same session (vs fresh sessions per recording)
- Single session for the entire batch (vs fresh per recording)

**For details, read [references/supporting/batch_replay.md](references/supporting/batch_replay.md).**