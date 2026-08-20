"""
Test 4: Session resume — pass resume="thread-123" and confirm conversation context carries.
Goal: Confirm resume works with arbitrary string IDs.
"""
import asyncio
import os
import uuid
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, StreamEvent

os.environ["ANTHROPIC_API_KEY"] = "97f5482590888eaa0afe9e173babd87c9abae1f5"
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8083/anthropic"

THREAD_ID = str(uuid.uuid4())  # session_id must be a valid UUID


async def main():
    print("=== TEST 4a: First message, create session ===\n")

    options1 = ClaudeAgentOptions(
        include_partial_messages=True,
        session_id=THREAD_ID,  # create with specific ID
    )

    async for message in query(
        prompt="My name is Alice. Remember this.",
        options=options1,
    ):
        if isinstance(message, ResultMessage):
            print(f"[Turn 1] subtype={message.subtype}, session_id={message.session_id}")
            print(f"  result: {message.result[:100] if message.result else None}")
            print(f"  num_turns: {message.num_turns}")
            break

    print("\n=== TEST 4b: Resume same session, ask about name ===\n")

    options2 = ClaudeAgentOptions(
        include_partial_messages=True,
        resume=THREAD_ID,  # resume existing session
    )

    async for message in query(
        prompt="What is my name?",
        options=options2,
    ):
        if isinstance(message, ResultMessage):
            print(f"[Turn 2] subtype={message.subtype}, session_id={message.session_id}")
            print(f"  result: {message.result[:200] if message.result else None}")
            print(f"  num_turns: {message.num_turns}")
            # Check if the model remembered "Alice"
            if message.result and "Alice" in message.result:
                print("  *** SUCCESS: Session context preserved!")
            else:
                print("  *** FAIL: Session context NOT preserved")
            break


if __name__ == "__main__":
    asyncio.run(main())
