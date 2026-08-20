"""
Test 8: Multi-turn with ClaudeSDKClient.
Goal: Confirm ClaudeSDKClient keeps context across multiple query() calls.
Pattern: connect() -> query() -> receive_response() -> repeat
"""
import asyncio
import os
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, ResultMessage

os.environ["ANTHROPIC_API_KEY"] = "97f5482590888eaa0afe9e173babd87c9abae1f5"
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8083/anthropic"


async def main():
    print("=== TEST 8: Multi-turn with ClaudeSDKClient ===\n")

    options = ClaudeAgentOptions(include_partial_messages=True)
    client = ClaudeSDKClient(options=options)

    # Connect (pass prompt to set initial context)
    await client.connect()
    print("Connected.")

    # Turn 1: Set context
    print("\n-- Turn 1: Set context --")
    await client.query(prompt="My favorite color is blue.")
    async for message in client.receive_response():
        if isinstance(message, ResultMessage):
            print(f"Turn 1 done. num_turns={message.num_turns}")
            break

    # Turn 2: Ask about context
    print("\n-- Turn 2: Ask about context --")
    await client.query(prompt="What is my favorite color?")
    async for message in client.receive_response():
        if isinstance(message, ResultMessage):
            print(f"result: {message.result}")
            if message.result and "blue" in message.result.lower():
                print("*** SUCCESS: Context preserved across turns!")
            else:
                print("*** FAIL: Context not preserved")
            break

    await client.disconnect()
    print("Disconnected.")


if __name__ == "__main__":
    asyncio.run(main())
