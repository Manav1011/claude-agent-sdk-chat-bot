"""
Test 3: Structured output — output_format with AgentResponse schema.
Goal: Confirm structured_output appears on ResultMessage.
Uses the same schema as the current chat_server.py.
"""
import asyncio
import os
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, StreamEvent, AssistantMessage

os.environ["ANTHROPIC_API_KEY"] = "97f5482590888eaa0afe9e173babd87c9abae1f5"
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8083/anthropic"

# Same schema as schemas.py AgentResponse
schema = {
    "type": "object",
    "properties": {
        "blocks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "markdown": {"type": "string"},
                    "spoken_explanation": {"type": "string"}
                },
                "required": ["markdown", "spoken_explanation"]
            }
        }
    },
    "required": ["blocks"]
}


async def main():
    print("=== TEST 3: Structured output ===\n")

    options = ClaudeAgentOptions(
        include_partial_messages=True,
        output_format={"type": "json_schema", "schema": schema},
    )

    async for message in query(
        prompt=(
            "Explain what a Python decorator is. Return your response as two blocks: "
            "first block should be markdown code showing a simple @decorator example, "
            "second block should be a spoken explanation of what decorators do."
        ),
        options=options,
    ):
        if isinstance(message, StreamEvent):
            evt = message.event
            evt_type = evt.get('type') if isinstance(evt, dict) else None
            # Only print start/stop/text_delta to keep output small
            if evt_type in ('message_start', 'content_block_start', 'content_block_stop', 'message_stop'):
                print(f"[StreamEvent] {evt_type}")
                if evt_type == 'content_block_start':
                    print(f"    block: {evt.get('content_block', {}).get('type')}")
            elif evt_type == 'content_block_delta':
                delta = evt.get('delta', {})
                d_type = delta.get('type')
                if d_type == 'text_delta':
                    print(f"[text_delta] {delta.get('text', '')[:80]}")

        elif isinstance(message, AssistantMessage):
            for cb in (message.content or []):
                print(f"[AssistantMessage block] {type(cb).__name__}")
                if hasattr(cb, 'text') and cb.text:
                    print(f"  text: {cb.text[:200]}")

        elif isinstance(message, ResultMessage):
            print(f"\n=== RESULT ===")
            print(f"    subtype: {message.subtype}")
            print(f"    stop_reason: {message.stop_reason}")
            print(f"    result: {str(message.result)[:200] if message.result else None}")
            print(f"    structured_output: {message.structured_output}")
            print(f"    num_turns: {message.num_turns}")
            break


if __name__ == "__main__":
    asyncio.run(main())
