# Step 1: Check Automation Wiki & Gather Details

Before starting ANY automation, check the automation wiki and gather all necessary details. This is the entry point — do not skip it.

## Directory Structure

The project uses an `automation-wiki/` directory at the project root as a knowledge base for all automations. It survives across sessions, is readable by both humans and Claude Code, and keeps every automation documented with its recordings, screenshots, and notes.

```
automation-wiki/
├── index.md                  ← table of contents / dashboard
├── {automation-name}/
│   ├── walkthrough.md        ← how to run, what it does, history
│   └── automations/          ← created by tools (do NOT create manually)
│       ├── recordings/       ← saved .json from stop_recording()
│       ├── screenshots/      ← screenshots taken during the run
│       └── snapshots/        ← accessibility snapshots
```

## Rules

### Rule 1: Check before starting

1. Read `automation-wiki/index.md`.
2. Normalize the name: lowercase, replace spaces/special chars with `-` (e.g. "Login Automation" → `login-automation`).
3. If the automation name already exists → ask: "Automation `login-automation` already exists. Use the existing walkthrough or create a new one?"
4. If user says "use it" → read the existing `walkthrough.md`, don't create a new folder.
5. If user says "new" → create the folder and walkthrough (see below).
6. If `automation-wiki/` or `index.md` doesn't exist → create it.

**If the user explicitly says "I know what I'm doing, just record"** → skip the wiki check, proceed with recording.

### Rule 2: After a successful recording, update `automation-wiki/index.md`

- Add a row to the automations table (preserve existing rows, append new one).
- Update "Quick Stats" counts (recount from the table, don't hardcode).
- Add a row to "Recent Activity".

### Rule 3: Update `walkthrough.md`

Fill in: Recording Type (`auto` or `human`), Recording path, Variables, Run Log entry.

### Rule 4: Table format is strict

Use exactly this format:

```markdown
| Name | Description | Status | Last Run | Tags |
```

- One row per automation
- Status must be `draft`, `active`, or `archived`
- Tags are comma-separated, no spaces
- If user changes status, update BOTH `walkthrough.md` AND `index.md`

### Rule 5: Archiving

When archiving: Update `status:` in `walkthrough.md` and `index.md`. Do NOT move the folder — it stays at `automation-wiki/{name}/` for easy reference.

### Rule 6: Gather Automation Details (NEW)

Before proceeding to step 2, gather the following details from the user. **All details must be collected before moving forward.**

**Ask the user ALL of the following questions at once:**

1. **Does this automation have dependencies on existing automations?**
   - If yes → call `list_recordings(wiki_root=...)` to see available recordings
   - Present the list to the user
   - Ask: "Which recordings does this automation depend on?"
   - User selects one or more (e.g. "login", "auth")
   - These will be replayed first in a fresh session before recording

2. **What is the scope of this automation?**
   - What pages/steps are automated?
   - What is NOT automated?

3. **What defines success?**
   - What should the final state look like?
   - What URL/element indicates completion?

**Present all questions together. Wait for the user to answer ALL of them before proceeding.**

If the user says "I don't know" or "just start" for any question → use reasonable defaults, then proceed.

## index.md Template

```markdown
# Automation Wiki

## Quick Stats
- **Active:** 0
- **Draft:** 0
- **Archived:** 0

## Automations

| Name | Description | Status | Last Run | Tags |
|------|-------------|--------|----------|------|

## Tags

None

## Recent Activity

| Date | Automation | Action | Result |
|------|-----------|--------|-------|
```

## walkthrough.md Template

```markdown
# {Automation Name}

## Purpose
{1-2 sentence description}

## Status
`draft` · `active` · `archived`

## Steps
1. {step}
2. {step}
3. ...

## Recording
**Type:** `auto` · `human`
**Path:** `recordings/{filename}.json`

## Variables
| Variable | Default | Required |
|----------|---------|----------|

## Expected Outcome
{what defines success}

## Notes
- {caveats, known issues, dependencies}

## Run Log
| Date | Result | Notes |
|------|--------|-------|
```

## Creating a New Automation (Full Flow)

```
1. User: "do the login automation"
2. Agent: reads automation-wiki/index.md
3. If exists → ask user (see Rule 1)
4. If not → create automation-wiki/ (if missing), create index.md (if missing), create {name}/ folder, create walkthrough.md with draft status
5. Agent asks for automation details (see Rule 6)
6. Wait for all answers before proceeding
7. Follow the link at the bottom of this file to step 2. Do NOT read step 3, 4, or 5 yet.
8. On successful stop_recording() → update index.md (add row, update stats, add to Recent Activity)
9. Update walkthrough.md: fill in Recording path, Variables, Run Log entry
```

## Status Values

| Status | Meaning |
|--------|---------|
| `draft` | Recorded but not verified in production |
| `active` | Verified, runs successfully on a regular basis |
| `archived` | No longer needed, but kept for reference |

## When to Update index.md

| Event | Action |
|-------|--------|
| New automation created | Add row, increment stat |
| Recording saved successfully | Add to Recent Activity, update Last Run |
| User says "mark as active" | Update status in walkthrough.md + index.md |
| User says "archive" | Update status in walkthrough.md + index.md (don't move folder) |

## UUID Format

Recording filenames: `{name}_{8-char-uuid}.json`

If two recordings collide (same UUID), append the timestamp: `{name}_{uuid}_{timestamp}.json`. This is extremely rare — the 8-char UUID is almost always sufficient.

## Recovery

If the agent crashes mid-run and the wiki is partially updated → leave it. The next run reconciles by:
1. Scanning `automation-wiki/{name}/recordings/` for `.json` files
2. Scanning `automation-wiki/index.md` for existing rows
3. If a folder exists but no index row → add the row
4. If an index row exists but no folder → flag as orphaned (don't delete, ask user)
5. If both exist → consistent state, proceed normally

## STOP — Do NOT proceed until the user confirms

**After completing the wiki check (Rule 1) and gathering details (Rule 6), ask the user:**
- If the wiki exists → "Automation `{name}` already exists. Use the existing walkthrough or create a new one?"
- If the wiki doesn't exist → "No automation wiki found. Should I create one for `{name}`?"
- Then ask for automation details (dependencies, scope, success criteria)

**Wait for the user's explicit answer and all details before doing anything else.** Do NOT auto-create, do NOT auto-proceed. Once the user confirms everything, then and only then follow the link to step 2.