# Step 2: Discovery

Discover everything possible from the codebase before asking the user or presenting a plan.

**The code is the source of truth.** Never guess about page behavior — verify with the code and live snapshots.

---

## Phase 1: Code Discovery

Use graphify to query the knowledge graph first. **`graphify query` is PREFERRED over reading raw graph files or scanning files directly.** The graph contains EXTRACTED + INFERRED edges that file reads cannot see. Only fall back to reading code or raw graph files if graphify returns nothing useful.

> **MANDATORY: Always run `graphify query` / `graphify path` / `graphify explain` from the project root directory — the directory where `graphify-out/` exists.** The agent MUST `cd` to the root directory first. Running from the wrong directory produces empty results.

1. **Graphify query** — Find selectors, relationships, and structure from the knowledge graph:
   - `cd {root_with_graphify-out}` → then `graphify query "Hire New Associate button"` → find selector
   - `graphify path "Employees page" "Hire Associate form"` → understand navigation
   - `graphify explain "multi-step form"` → understand form structure
   - Use natural language in queries — the graph indexes components, pages, buttons, forms, and their relationships

2. **Read source code** — Find exact selectors (use results from graphify to know which files to read):
   - `Read src/components/Auth/Auth.tsx` → find `#auth-input-email`
   - Read the form component → find all fields and their IDs
   - Check success conditions → what defines "done" (redirect, toast, element visible)

3. **Document findings** — Note selectors, navigation flow, and any gaps in understanding.

---

## Phase 2: Live Exploration (MANDATORY)

After code discovery, verify your assumptions in a live browser session. Code can be misleading — components render conditionally, buttons trigger JS without navigation, elements appear only after interaction.

**Do NOT skip to planning until this phase is complete.**

### Exploration Rules

**Exploration is READ-ONLY verification.** Do NOT fill forms, submit, or log in. Use `get_attribute()`, `snapshot()`, `get_text()`, and `assert_*` tools only.

**Heavy reliance on snapshots and screenshots:** Before executing any tool (`fill()`, `click()`, `navigate()`), take a snapshot or screenshot to verify what's actually on the page. Do NOT guess what the page looks like — see it first. The agent should NOT execute tools until it has visual confirmation of what's on the page.

- **Snapshot** — YAML/text representation of the page. Use this for verifying selectors, checking element state, and understanding structure.
- **Screenshot** — visual image of the page. Use this when snapshot is ambiguous or you need to see what the page looks like visually (e.g., layout, overlapping elements, hidden UI).

**Exploration session is for understanding. Recording session is for capturing.** These are separate sessions. The exploration session must start and end in the same state.

### Execution Order

1. **Start exploration session** — `session_start(base_dir="/tmp", exploration=True)` — `exploration=True` disables action logging. Snapshots/screenshots go to `/tmp/automations/`. This session is READ-ONLY: verify selectors, take snapshots, check behavior. Never fill or click.
2. **Replay dependencies** (if any) → ensure the page is in the correct state
3. **Navigate to each relevant URL** from Phase 1
4. **Take a snapshot** of the page → see what's actually rendered
5. **Verify selectors exist** — call `get_attribute("#selector", "disabled")` or `get_text("#selector")` to confirm elements are in the DOM
6. **Verify behavior** — does clicking the button navigate? Open a modal? Submit a form? Check the code AND the live page match
7. **Close exploration session** — `session_close(session_id=exploration_session)`

---

## Phase 3: Ask User (Only for Code-Undiscoverable Things)

Only ask about things that cannot be found in the code:

- **Dummy data values** — "What name/email should I use for testing?"
- **Out-of-scope items** — "What should NOT be automated?"
- **Unclear scope/success criteria** — If the code doesn't make it clear

**Do NOT ask:**
- Where is the button? → Use graphify + code
- What selectors exist? → Use code
- How many form steps? → Use code + exploration
- What is the target URL? → Use code

---

## STOP — Exploration Must Be Complete Before Proceeding

**Before presenting the plan, confirm:**
- [ ] Code discovery done (graphify + source code read)
- [ ] Live exploration done (snapshots taken for every page, selectors verified in browser)
- [ ] All user questions asked (if any)

**Then ask user:**
- Scope (what's NOT automated)
- Success criteria (if not obvious from code)
- Dummy data values (name/email to use)

Present all questions at once. Wait for answers before proceeding.

If user says "I don't know" or "just start" → default to minimal scope, proceed to step 3.

---

## Next Step

Once discovery is complete and user questions are answered, present the plan. Read [references/step_3_plan.md](references/step_3_plan.md).