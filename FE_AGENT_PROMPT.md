# Frontend Agent Prompt: Blocks Mode Implementation

## Context

We have a single-file chat frontend at `/home/web-h-063/Documents/explainer-bot/index.html`. It currently supports "normal mode" (streaming text deltas, thinking, tool results). We're adding a new **"blocks mode"** where the AI can return structured content blocks with Markdown and spoken explanations.

**Constraints:**
- Do NOT modify any other files. Only modify `index.html`.
- The backend already handles both modes correctly.
- The app is a single HTML file with no build step. Use vanilla JS + Tailwind (via CDN).
- Existing normal-mode behavior must continue to work unchanged.

---

## What You Need to Implement

### 1. State: Add `currentMode` and blocks tracking

Add to the `state` object:
```js
state.currentMode = 'normal'; // 'normal' or 'blocks'
```

Add a `blocks` map to `state`:
```js
state.blocks = {}; // threadId -> list of enriched blocks
```

### 2. UI: Add Mode Toggle in Header Bar

Add a mode toggle in the **main area header** (the row with "QA Automation Agent" / mobile nav area). Place it to the right of the title text, or as a dedicated section in the top of the main area.

The toggle should:
- Show "Normal" / "Blocks" as two clickable states
- Currently selected state has brand-colored background (like `bg-brand`) and white text
- Unselected state has dark elevated background with muted text
- Small pill-style toggle (not a checkbox)
- Update `state.currentMode` when clicked

Example layout (inside the existing `main > div` that wraps the chat):
```html
<!-- Before the messages-container, add a small bar -->
<div class="flex items-center justify-between px-4 lg:px-6 pt-3">
  <!-- Mode Toggle -->
  <div class="flex bg-dark-elevated rounded-lg p-0.5 border border-dark-border">
    <button id="mode-normal" class="mode-btn ...">Normal</button>
    <button id="mode-blocks" class="mode-btn ...">Blocks</button>
  </div>
</div>
```

CSS for the toggle:
- Selected: `bg-brand text-white font-medium shadow-sm`
- Unselected: `text-txt-subtle hover:text-white`

### 3. API: Send `response_mode` in Request

In the `streamChat` function, modify the request body to include the current mode:
```js
body: JSON.stringify({ 
  message, 
  thread_id: threadId,
  workspace: state.currentWorkspace || undefined,
  response_mode: state.currentMode,  // ADD THIS
}),
```

### 4. SSE Event Handling: `content_block` Events

The backend emits `content_block` SSE events when in blocks mode:
```
event: message
data: {"type": "content_block", "uuid": "550e8400-e29b-41d4-a716-446655440000", "sequence_id": 1, "markdown": "...", "spoken_explanation": "..."}
```

You need to handle this in the `sendMessage` loop. Add a case for `data.type === 'content_block'`:

When you receive a `content_block` event:
1. Append it to `state.blocks[threadId]`
2. Render it immediately in the chat

### 5. Block Rendering Component

Create a new function `renderBlockNode(block, threadId)`:

Each block renders as a card with:
- **Left icon**: a small accent icon (e.g., a document/code icon) in brand color
- **Sequence badge**: "Block 1", "Block 2" etc. (small, muted text)
- **Markdown content**: Rendered with `marked.parse(block.markdown)`, inside a styled card
  - Use existing `prose-dark` styling
  - Code blocks get syntax highlighting via `highlight.js`
- **Collapsible "Read Aloud" section**: Below the Markdown content
  - A small button labeled "Read Aloud" (or a speaker icon)
  - When clicked, expand to show the `spoken_explanation` text
  - Include a "Play" button that could use `speechSynthesis` API in the future
  - By default, the spoken_explanation section is collapsed (hidden)

The card should look like:
```
[Icon] Block 1
┌─────────────────────────────────────────────┐
│  [Markdown content rendered here]            │
│                                              │
│  ```python                                   │
│  def add(a, b):                              │
│      return a + b                            │
│  ```                                         │
├─────────────────────────────────────────────┤
│  Read Aloud (collapsed by default)           │
│  [Expanded: "Here's a Python function that   │
│   adds two numbers together."]               │
└─────────────────────────────────────────────┘
```

Styling:
- Card: `bg-dark-surface border border-dark-border rounded-xl px-4 py-3 max-w-[90%] shadow-card-glow`
- Markdown: use existing `.prose-dark` class
- Speak button: `text-xs text-txt-subtle hover:text-brand transition-colors flex items-center gap-1`
- Spoken text (when expanded): `text-sm text-txt-muted mt-2 pt-2 border-t border-dark-border/40`

Use the existing `animate-msg` animation class for entrance.

### 6. Done Event: Show Response Mode Badge

When the `done` event arrives, show which mode was used:

If `data.response_mode === 'blocks'`:
- Add a small badge to the AI card: `"Blocks Mode · {block_count} blocks"`
- This goes below the usage badge
- Style: `text-[9px] px-1.5 py-0.5 rounded bg-brand/10 text-brand border border-brand/20`

If `data.response_mode === 'normal'` or `response_mode` is absent:
- No badge needed (existing behavior)

**Edge case**: If `data.response_mode === 'blocks'` but `data.block_count === 0`, the model failed to generate blocks. Show a subtle "No blocks generated" message instead.

### 7. History Rendering: Include Blocks

When `selectSession` loads session history from `/api/sessions/{threadId}/messages`:
- The response includes `enriched_blocks` in the data **only for blocks-mode sessions**
- For normal-mode sessions, `enriched_blocks` will be `null` or absent
- Store them: `state.blocks[threadId] = data.enriched_blocks || []`
- **Handle gracefully**: If `enriched_blocks` is `null`, `false`, or missing, do nothing (don't throw errors)
- After rendering regular messages, if `state.blocks[threadId]` exists and has blocks, render them

In the `selectSession` function, after the existing message rendering loop:
```js
const blocks = data.enriched_blocks || null;
if (blocks && Array.isArray(blocks) && blocks.length > 0) {
  state.blocks[threadId] = blocks;
  for (const block of blocks) {
    renderBlockNode(block, threadId);
  }
}
```

### 8. Update Token Stats Widget (Optional Enhancement)

The `done` event in blocks mode includes `block_count`. You could show this in the token widget as a "Blocks" counter:
```
Context: {context} | Blocks: {block_count}
```

### 9. Normal Mode Backward Compatibility (CRITICAL)

The frontend **MUST** continue working identically for normal mode sessions. Specifically:

- **Normal mode SSE events**: `text_delta`, `thinking_delta`, `tool_result`, `done` — no changes needed. The existing handler code should work as-is.
- **Normal mode session response**: `enriched_blocks` field will be `null` or absent. Your history rendering code must handle this without errors.
- **Normal mode done event**: `response_mode` will be `"normal"` or absent. The badge code must check for `"blocks"` specifically, not just "not normal".
- **The existing streaming loop**: The `text_delta` handler that builds the AI card incrementally (`activeAiWrapper`, `activeAiTextEl`) is used in normal mode. In blocks mode, this code should NOT fire — only `thinking_delta` should stream, then `content_block` events appear atomically.

### 10. Edge Cases & Robustness

| Scenario | Expected Behavior |
|----------|-------------------|
| User sends "blocks" message but model ignores it | Backend still emits `content_block` events. If block_count=0, show fallback. |
| Blocks mode request but network drops mid-stream | Existing error handler in `finally` block catches AbortError. Show error message. |
| Session has blocks but user clicks "New Conversation" | State clears including `state.blocks`. No stale blocks leak into new session. |
| User toggles mode mid-stream | Abort current stream, switch mode, start new stream. |
| Empty `markdown` or `spoken_explanation` in block | Render empty card with placeholder text. Don't crash. |
| `uuid` collision (extremely unlikely) | Use `crypto.randomUUID()` for client-side IDs as fallback. |

**Note on `uuid`**: Each block has a server-generated `uuid` (e.g., `550e8400-e29b-41d4-a716-446655440000`). This is NOT used for rendering but will be used later for block-context questions (e.g., "explain this block" targeting a specific block by UUID). You can log it to console for debugging but don't display it to the user.

---

## Backend Reference (for your understanding)

### SSE Events (blocks mode)

```
event: message
data: {"type": "thinking_delta", "content": "..."}

event: message
data: {"type": "tool_result", "name": "write_todos", "input": {"todos": [...]}, "content": "..."}

event: message
data: {"type": "content_block", "uuid": "550e8400-e29b-41d4-a716-446655440000", "sequence_id": 1, "markdown": "...", "spoken_explanation": "..."}

event: done
data: {"thread_id": "session-abc123", "usage": {...}, "response_mode": "blocks", "block_count": 2}
```

### Session Messages API Response

```json
{
  "thread_id": "session-abc123",
  "messages": [...],
  "enriched_blocks": [
    {
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "sequence_id": 1,
      "markdown": "```python\n...",
      "spoken_explanation": "A Python function that adds two numbers."
    }
  ]
}
```

### Chat Request

```json
{
  "message": "...",
  "thread_id": "session-abc123",
  "workspace": "/tmp/workspace",
  "response_mode": "blocks"
}
```

---

## Testing Checklist

After implementing, verify:

1. **Normal mode still works**: Send a message in normal mode, see text streaming, tool results, done event
2. **Blocks mode toggle**: Click "Blocks" in header, toggle switches state visually
3. **Blocks mode streaming**: Send "Give me a Python block" in blocks mode, see:
   - Thinking deltas stream normally
   - Tool results (write_todos, AgentResponse) appear
   - `content_block` card appears with Markdown + collapsible "Read Aloud"
4. **Block count in done**: Done event shows "Blocks Mode · 1 blocks" badge
5. **Session history**: Reload the page, select the session, see blocks rendered
6. **Switching modes**: Toggle back to Normal, send message, should stream text normally
7. **Multiple blocks**: Send "Give me two blocks: one Python, one SQL", see two block cards

---

## Summary of Changes to Make

| File | Changes |
|------|---------|
| `state` object | Add `currentMode`, `blocks` |
| Header area | Add mode toggle UI |
| `streamChat` | Add `response_mode` to request body |
| `sendMessage` loop | Handle `data.type === 'content_block'` |
| New function | `renderBlockNode(block, threadId)` |
| `done` handler | Show response_mode badge when blocks |
| `selectSession` | Render `enriched_blocks` on history load |
| Listeners | Add click handlers for mode toggle |
