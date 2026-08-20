"""
Test 1: Basic streaming query — see all event types.
Goal: Understand the raw shape of streaming events from query().
"""
import asyncio
import os
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, StreamEvent, AssistantMessage, SystemMessage, UserMessage

# Set env before import so the subprocess inherits it
os.environ["ANTHROPIC_API_KEY"] = "97f5482590888eaa0afe9e173babd87c9abae1f5"
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8083/anthropic"


async def main():
    print("=== TEST 1: Basic streaming query ===\n")

    options = ClaudeAgentOptions(
        include_partial_messages=True,
    )

    count = 0
    async for message in query(
        prompt="List 3 popular movies and give one sentence about each.",
        options=options,
    ):
        count += 1
        msg_type = type(message).__name__

        print(f"[{count}] {msg_type}")

        if isinstance(message, StreamEvent):
            print(f"    event: {message.event}")
            print(f"    session_id: {message.session_id}")
            print(f"    uuid: {message.uuid}")
            print(f"    parent_tool_use_id: {message.parent_tool_use_id}")
        elif isinstance(message, AssistantMessage):
            print(f"    content blocks ({len(message.content) if message.content else 0}):")
            for cb in (message.content or []):
                print(f"      - {type(cb).__name__}: {str(cb)[:200]}")
            print(f"    model: {message.model}")
            print(f"    usage: {message.usage}")
            print(f"    stop_reason: {message.stop_reason}")
        elif isinstance(message, SystemMessage):
            print(f"    subtype: {message.subtype}")
            print(f"    data keys: {list(message.data.keys()) if message.data else []}")
        elif isinstance(message, UserMessage):
            print(f"    content: {str(message.content)[:200]}")
        elif isinstance(message, ResultMessage):
            print(f"    subtype: {message.subtype}")
            print(f"    stop_reason: {message.stop_reason}")
            print(f"    result: {str(message.result)[:300] if message.result else None}")
            print(f"    structured_output: {message.structured_output}")
            print(f"    total_cost_usd: {message.total_cost_usd}")
            print(f"    usage: {message.usage}")
            print(f"    num_turns: {message.num_turns}")
            break
        else:
            attrs = {a: getattr(message, a, None) for a in dir(message) if not a.startswith('_')}
            for k, v in attrs.items():
                if v is None or v == '' or v == [] or v == {}:
                    continue
                if k in ('content', 'additional_kwargs'):
                    continue
                print(f"    {k}: {str(v)[:200]}")
        print()


if __name__ == "__main__":
    asyncio.run(main())
