"""
Test 7: system_prompt variants.
Goal: See how different system_prompt values affect behavior.
"""
import asyncio
import os
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

os.environ["ANTHROPIC_API_KEY"] = "97f5482590888eaa0afe9e173babd87c9abae1f5"
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8083/anthropic"


async def main():
    print("=== TEST 7a: system_prompt=None (minimal) ===\n")

    options = ClaudeAgentOptions(system_prompt=None)

    async for message in query(
        prompt="Count from 1 to 3.",
        options=options,
    ):
        if isinstance(message, ResultMessage):
            print(f"result: {message.result[:200] if message.result else None}")
            break

    print("\n=== TEST 7b: system_prompt='You are a pirate.' ===\n")

    options2 = ClaudeAgentOptions(system_prompt="You are a pirate. Speak in pirate style.")

    async for message in query(
        prompt="Count from 1 to 3.",
        options=options2,
    ):
        if isinstance(message, ResultMessage):
            print(f"result: {message.result[:200] if message.result else None}")
            break

    print("\n=== TEST 7c: system_prompt preset claude_code ===\n")

    options3 = ClaudeAgentOptions(
        system_prompt={"type": "preset", "preset": "claude_code"}
    )

    async for message in query(
        prompt="Count from 1 to 3.",
        options=options3,
    ):
        if isinstance(message, ResultMessage):
            print(f"result: {message.result[:200] if message.result else None}")
            break


if __name__ == "__main__":
    asyncio.run(main())
