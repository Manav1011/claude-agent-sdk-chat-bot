# FE Agent Prompt: Blocks Mode → Speech Explanation Mode

## Context for FE Agent

We've **removed blocks mode entirely**. The separate "blocks panel" UI is no longer needed.

---

## What Changed

### Before (Blocks Mode)
- `POST /api/chat` accepted `response_mode: "normal" | "blocks"`
- In `blocks` mode, every AI response was split into multiple `ContentBlock` objects
- Each block had: `markdown` (rendered content) + `spoken_explanation` (TTS text)
- The FE had to render a multi-block structured response with a separate panel for spoken content
- Token-heavy: sent full markdown + spoken text for each block

### After (Speech Explanation Mode)
- `POST /api/chat` accepts `speech_explanation: true | false` (boolean toggle)
- When enabled, the model produces **one explanation per full response** via structured output
- SSE emits a `speech_explanation` event alongside the normal text stream
- The explanation is a single string — suitable for TTS playback
- In history, it's attached as a `speech_explanation` field on the AI message object

---

## How to Configure

### Settings Panel
Add a toggle in the settings panel:
- **Label**: "Speech Explanation" or "Voice Mode"
- **Description**: "Enable spoken explanations for AI responses"
- **Type**: boolean toggle
- **Default**: `false`

When enabled, pass `speech_explanation: true` in every chat request.

---

## Chat API Usage

### Request
```json
POST /api/chat
{
  "message": "what is recursion?",
  "project_id": 2,
  "speech_explanation": true
}
```

### SSE Response (when enabled)
```
data: {"type": "text_delta", "content": "Recursion is..."}
data: {"type": "text_delta", "content": "..."}
data: {"type": "speech_explanation", "content": "Recursion is a function that calls itself to solve progressively smaller versions of the same problem..."}
data: {"type": "done", "thread_id": "...", "usage": {...}}
```

The `speech_explanation` event fires **after** the full text stream completes, containing the TTS-ready explanation string.

### History API
```json
GET /api/sessions/{session_id}/messages

{
  "session_id": "...",
  "messages": [
    {"role": "human", "content": "..."},
    {"role": "ai", "content": "...", "speech_explanation": "The full TTS explanation string..."}
  ]
}
```

---

## Migration Notes

- Remove all `response_mode` logic from the FE
- Remove the multi-block renderer / blocks panel UI
- Add `speech_explanation` boolean to the settings/config
- The `speech_explanation` field on AI messages in history can be used to rehydrate TTS content when scrolling back
