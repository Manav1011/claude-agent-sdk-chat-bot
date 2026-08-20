"""
Test 5: Skills discovery and restriction.
Goal: Understand how skills option works.
"""
import asyncio
import os
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

os.environ["ANTHROPIC_API_KEY"] = "97f5482590888eaa0afe9e173babd87c9abae1f5"
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8083/anthropic"


async def main():
    print("=== TEST 5a: skills=[] (no skills) ===\n")

    options_no_skills = ClaudeAgentOptions(skills=[])

    async for message in query(
        prompt="List your available skills or tools. What can you do?",
        options=options_no_skills,
    ):
        if isinstance(message, ResultMessage):
            print(f"result: {message.result[:300] if message.result else None}")
            break

    print("\n=== TEST 5b: skills='all' ===\n")

    options_all_skills = ClaudeAgentOptions(skills="all")

    async for message in query(
        prompt="List your available skills or tools. What can you do?",
        options=options_all_skills,
    ):
        if isinstance(message, ResultMessage):
            print(f"result: {message.result[:500] if message.result else None}")
            break


if __name__ == "__main__":
    asyncio.run(main())
