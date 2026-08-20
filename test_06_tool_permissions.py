"""
Test 6: allowed_tools and permission_mode.
Goal: Confirm restricting tools works.
"""
import asyncio
import os
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

os.environ["ANTHROPIC_API_KEY"] = "97f5482590888eaa0afe9e173babd87c9abae1f5"
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8083/anthropic"


async def main():
    print("=== TEST 6a: allowed_tools=[Read] only ===\n")

    options = ClaudeAgentOptions(
        allowed_tools=["Read"],
    )

    async for message in query(
        prompt="Read the file schemas.py in this directory.",
        options=options,
    ):
        if isinstance(message, ResultMessage):
            print(f"subtype: {message.subtype}")
            print(f"result: {message.result[:300] if message.result else None}")
            print(f"num_turns: {message.num_turns}")
            break

    print("\n=== TEST 6b: allowed_tools=[Read], try Bash — should be denied ===\n")

    options2 = ClaudeAgentOptions(
        allowed_tools=["Read"],
    )

    async for message in query(
        prompt="Run: echo 'hello world'",
        options=options2,
    ):
        if isinstance(message, ResultMessage):
            print(f"subtype: {message.subtype}")
            print(f"result: {message.result[:300] if message.result else None}")
            print(f"num_turns: {message.num_turns}")
            print(f"permission_denials: {message.permission_denials}")
            break


if __name__ == "__main__":
    asyncio.run(main())
