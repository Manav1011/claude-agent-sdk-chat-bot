# Wait Strategy

Use `wait_for_*` — never `sleep()`.

## By Scenario

| Scenario | Wait Method |
|----------|-------------|
| Auth0/OAuth callback | `wait_for_load_state("networkidle")` |
| Known URL redirect | `wait_for_url("*target*", timeout=5000)` |
| Dynamic content loading | `wait_for_load_state("networkidle")` |
| Form submit (no URL change) | `wait_for_selector("selector-on-next-page")` or `wait_for_load_state` |
| SPA (no URL change after submit) | Wait for a DOM element on the next page (e.g., sidebar appears, auth-submit-action-btn disappears). **NOT for text or URL** — text may not show, URL doesn't change. |

## Forbidden

- `sleep()` — use `wait_for_*` instead.

## Examples

```python
# Auth callback
navigate("https://auth0.com/login")
click("button[type='submit']")
wait_for_load_state("networkidle")  # wait for OAuth redirect

# Known URL redirect
click("a[href='/dashboard']")
wait_for_url("*dashboard*", timeout=5000)

# Dynamic content
click("button.load-more")
wait_for_load_state("networkidle")  # wait for lazy-loaded content

# SPA navigation (no URL change)
click("nav > a.dashboard")
wait_for_selector(".sidebar", timeout=5000)  # wait for sidebar to appear
```