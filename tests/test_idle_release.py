"""Self-check: _idle_watcher releases the SDK client for idle-but-viewed
sessions, but never while a turn holds the session lock."""
import asyncio
import sys
import types

sys.path.insert(0, ".")
import chat_server as cs


class FakeClient:
    def __init__(self):
        self.disconnected = False

    async def disconnect(self):
        self.disconnected = True


class FakeIncoming:
    def qsize(self):
        return 0


def make_ns():
    return types.SimpleNamespace(
        _running=True,
        _last_activity=0.0,  # far in the past vs time.time()
        _incoming=FakeIncoming(),
        session_id="s1",
        _subscribers={"q"},  # open tab: full reap must NOT run
        _client=FakeClient(),
    )


async def run_watcher_once(ns, sleep_calls):
    async def fake_sleep(_t):
        sleep_calls.append(1)
        if len(sleep_calls) >= 2:
            raise asyncio.CancelledError
    real = asyncio.sleep
    asyncio.sleep = fake_sleep
    try:
        await cs.SessionLoop._idle_watcher(ns)
    except asyncio.CancelledError:
        pass
    finally:
        asyncio.sleep = real


async def main():
    cs._SESSION_IDLE_TIMEOUT = -1  # every session is "idle"

    # Case 1: turn in progress (session lock held) -> client survives.
    lk = asyncio.Lock()
    cs._session_locks["s1"] = lk
    await lk.acquire()
    ns = make_ns()
    await run_watcher_once(ns, [])
    assert not ns._client.disconnected, "released client mid-turn!"
    lk.release()

    # Case 2: no turn, tab open -> client released, loop kept.
    await run_watcher_once(ns, [])
    assert ns._client is None or ns._client.disconnected, "idle client not released"
    assert ns._running, "loop must stay alive while subscribers exist"
    print("idle-release: OK")


asyncio.run(main())
