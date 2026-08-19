# Selector Priority

Before attempting any click or fill, resolve selectors in this order. This is the single most important rule — every step in the automation must follow it.

## Priority Order

1. **Graphify** — query knowledge graph for component relationships (MANDATORY for internal pages)
2. **Read code** — find exact selectors (href, id, text) in source
3. **Playwright direct** — click/fill with code-derived selectors
4. **JS execute** — find selectors via DOM when code doesn't reveal them
5. **Snapshot** — analyze YAML to find selectors (last resort)
6. **Screenshot** — visual inspection (last resort, only when snapshot fails)

**Graphify is not optional for internal pages.** Use it in the discovery phase to understand page structure, component relationships, and navigation flow.

## Graphify Directory Check

Before calling `graphify query`:
- Verify `graphify-out/graph.json` exists in the working directory
- If missing: fall back to reading code directly (don't try to generate the graph)

## Graphify for Internal Pages

```
navigate("{{TARGET_URL}}")
→ wait_for_load_state("networkidle")
→ graphify query "page name navbar"
→ Read component → find href/id/text → use code-derived selector
→ click("a[href='/target-route']")
→ record_step()
→ wait_for_url("*target-route*", timeout=5000)
```

## Snapshot Gate

**Snapshot requires prior code-derived selector attempt.**

Before calling `snapshot()`:
- Did you read the code for the selector? → YES → skip snapshot
- Did you try code and it failed? → YES → record failure reason → call snapshot

## Click Fails → Escalation

```
click("button:has-text('Submit')") → found: false
→ list_tabs() — confirm URL changed
→ execute("document.querySelectorAll('button').find(b => b.getBoundingClientRect().width > 200 && b.textContent.includes('Submit')).click()")
→ snapshot() — last resort, only if code and JS both fail
```