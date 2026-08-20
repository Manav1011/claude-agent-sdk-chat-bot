"""Quick test to see what usage fields the SDK returns."""
import asyncio
import os
import sys

sys.path.insert(0, '/home/web-h-063/Documents/explainer-bot')
os.environ["ANTHROPIC_API_KEY"] = os.environ.get("LLM_API_KEY", "")
os.environ["ANTHROPIC_BASE_URL"] = os.environ.get("LLM_BASE_URL", "http://localhost:8083/anthropic")

from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

async def main():
    async for msg in query(
        prompt="Say exactly: hi",
        options=ClaudeAgentOptions(include_partial_messages=True),
    ):
        if isinstance(msg, ResultMessage):
            print(f"usage: {msg.usage}")
            print(f"model_usage: {msg.model_usage}")
            print(f"total_cost_usd: {msg.total_cost_usd}")
            break

asyncio.run(main())
