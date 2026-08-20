"""
Test 2: Tool call streaming — inspect content_block_start/delta/stop + tool results.
Goal: Understand how tool calls are streamed and how tool results come back.
"""
import asyncio
import os
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, StreamEvent, AssistantMessage, SystemMessage, UserMessage

os.environ["ANTHROPIC_API_KEY"] = "97f5482590888eaa0afe9e173babd87c9abae1f5"
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8083/anthropic"


async def main():
    print("=== TEST 2: Tool call streaming ===\n")

    options = ClaudeAgentOptions(
        include_partial_messages=True,
    )

    async for message in query(
        # Ask for something that triggers a tool call
        prompt="Read the file schemas.py in this directory and tell me what it's about.",
        options=options,
    ):
        msg_type = type(message).__name__

        if isinstance(message, StreamEvent):
            evt = message.event
            evt_type = evt.get('type') if isinstance(evt, dict) else None

            # Only show relevant events
            if evt_type in ('content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'):
                print(f"[StreamEvent] {evt_type}")

                if evt_type == 'content_block_start':
                    cb = evt.get('content_block', {})
                    print(f"    block type: {cb.get('type')}")
                    print(f"    tool name: {cb.get('name')}")
                    print(f"    tool id: {cb.get('id')}")
                    print(f"    input: {str(cb.get('input', {}))[:200]}")

                elif evt_type == 'content_block_delta':
                    delta = evt.get('delta', {})
                    d_type = delta.get('type')
                    print(f"    delta type: {d_type}")
                    if d_type == 'input_json_delta':
                        print(f"    partial_json: {delta.get('partial_json', '')}")
                    elif d_type in ('text_delta', 'thinking_delta'):
                        print(f"    text: {str(delta.get(d_type, ''))[:100]}")
                    elif d_type == 'signature_delta':
                        print(f"    signature: {delta.get('signature', '')[:50]}")

                elif evt_type == 'content_block_stop':
                    print(f"    index: {evt.get('index')}")

                elif evt_type == 'message_delta':
                    print(f"    stop_reason: {evt.get('delta', {}).get('stop_reason')}")
                    usage = evt.get('usage', {})
                    if usage:
                        print(f"    output_tokens: {usage.get('output_tokens')}")

                elif evt_type == 'message_stop':
                    print(f"    *** message_stop received")

            elif evt_type == 'message_start':
                print(f"[StreamEvent] message_start — model: {evt.get('message', {}).get('model')}")

        elif isinstance(message, UserMessage):
            # Tool result comes as UserMessage
            content = message.content
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get('type') == 'tool_result':
                        print(f"\n[UserMessage / tool_result] name: {block.get('name')}")
                        print(f"    tool_use_id: {block.get('tool_use_id')}")
                        print(f"    content: {str(block.get('content', ''))[:300]}")
            else:
                print(f"[UserMessage] content: {str(content)[:200]}")

        elif isinstance(message, AssistantMessage):
            print(f"\n[AssistantMessage] stop_reason: {message.stop_reason}")
            for cb in (message.content or []):
                print(f"    block: {type(cb).__name__}")
                if hasattr(cb, 'name'):
                    print(f"      name: {cb.name}")
                    print(f"      input: {str(getattr(cb, 'input', {}))[:200]}")
                if hasattr(cb, 'content'):
                    print(f"      content: {str(cb.content)[:200]}")
                if hasattr(cb, 'tool_use_id'):
                    print(f"      tool_use_id: {cb.tool_use_id}")

        elif isinstance(message, ResultMessage):
            print(f"\n=== RESULT ===")
            print(f"    subtype: {message.subtype}")
            print(f"    stop_reason: {message.stop_reason}")
            print(f"    result: {str(message.result)[:300] if message.result else None}")
            print(f"    num_turns: {message.num_turns}")
            break

        else:
            # Hook events, init, etc — skip
            pass


if __name__ == "__main__":
    asyncio.run(main())
