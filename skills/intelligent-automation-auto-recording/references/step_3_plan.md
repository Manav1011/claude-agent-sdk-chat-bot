# Step 3: Plan (MANDATORY)

Before any tool calls, present a plan and **WAIT for approval.** Not after. Not "I'll figure it out as I go." Present the plan, wait for "yes"/"go"/"start", then only then call tools.

## Plan Format

Present this exact structure and wait for the user to approve:

```
Title: {profile}-{short-description}
Flow: {1-2 sentence summary}
Steps:
  1. navigate → {target}
  2. {action} → {target}
  3. ...

Scope:
  IN:  {what's automated — specific and narrow}
  OUT: {what's NOT automated — even if it looks related}

Wiki: automation-wiki/{name}/walkthrough.md

Ready to start?
```

## STOP — Do NOT proceed until the user explicitly approves

**Present the plan and WAIT. Do NOT call any tools until the user says "yes", "go", or "start."**

- User's "yes"/"go"/"start" → proceed to [references/step_4_execution.md](references/step_4_execution.md)
- User's "change X" → update plan → re-present (still wait)
- User's "cancel" → don't record, don't execute, stop entirely

**If the user does not explicitly approve, do NOT proceed.** Do NOT assume approval from silence or from them asking a follow-up question.

## Next Step

Once the user approves the plan, proceed to [references/step_4_execution.md](references/step_4_execution.md).