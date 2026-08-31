"""FastAPI server for QA Automation Chatbot — Claude Agent SDK only."""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import uuid
import wave
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Literal, Any, cast

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, PermissionMode
from claude_agent_sdk import ResultMessage, StreamEvent, list_sessions as sdk_list_sessions
from claude_agent_sdk.types import (
    PermissionResultAllow,
    PermissionResultDeny,
    SettingSource,
    ToolPermissionContext,
)

from schemas import Project, ProjectCreate, ProjectsListResponse, ProjectSessionsResponse, SessionResponse

HOST = "0.0.0.0"
PORT = 8225

LLM_MODEL = os.environ.get("LLM_MODEL", "MiniMaxAI/MiniMax-M3")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjgyNTk1NTQ1LTAyMDYtNGVlMy1hMjg3LTZhM2RiYjI2OTQzNSIsInNjb3BlIjoiaWVfbW9kZWwiLCJwcm9kdWN0IjoiSUUiLCJvd25lcklkIjoiZDNkY2VjMjgtMjQ5MS00NmU1LWI2YmYtZDcyYzg0YmRmZGEyIn0._R-wta0JXQRi3FbA7S0IXqC_sT14maRy0CwZ7kl4tM4")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8083/anthropic")

# Cache HTML frontends at module load time
_FE_DIST_PATH = Path(__file__).parent / "FE" / "dist"
_FE_INDEX_PATH = _FE_DIST_PATH / "index.html"
_HTML_PATH = Path(__file__).parent / "index.html"
_CACHED_HTML = _HTML_PATH.read_text() if _HTML_PATH.exists() else "<h1>index.html not found</h1>"
_MAXIMALISM_HTML_PATH = Path(__file__).parent / "maximalism" / "index.html"
_MAXIMALISM_HTML = _MAXIMALISM_HTML_PATH.read_text() if _MAXIMALISM_HTML_PATH.exists() else "<h1>maximalism/index.html not found</h1>"
_RETRO_HTML_PATH = Path(__file__).parent / "retro" / "index.html"
_RETRO_HTML = _RETRO_HTML_PATH.read_text() if _RETRO_HTML_PATH.exists() else "<h1>retro/index.html not found</h1>"
_INDUSTRIAL_HTML_PATH = Path(__file__).parent / "industrial" / "index.html"
_INDUSTRIAL_HTML = _INDUSTRIAL_HTML_PATH.read_text() if _INDUSTRIAL_HTML_PATH.exists() else "<h1>industrial/index.html not found</h1>"

_DEFAULT_WORKSPACE = "."

# ============== Permission registry ==============
# Maps (session_id, request_id) -> asyncio.Future that frontend resolves via POST /api/permissions/decision
_permission_futures: dict[tuple[str, str], asyncio.Future] = {}
_permission_meta: dict[tuple[str, str], dict] = {}

# ============== SQLite (projects DB) ==============
import sqlite3
import collections

_DB_PATH = Path(__file__).parent / "projects.db"

def _get_db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _init_db():
    with _get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.commit()

def _resolve_workspace(project_id: int | None) -> str:
    """Resolve project_id to workspace path. Falls back to default if not found."""
    if project_id is not None:
        with _get_db() as db:
            row = db.execute("SELECT path FROM projects WHERE id = ?", (project_id,)).fetchone()
            if row:
                return row["path"]
    return _DEFAULT_WORKSPACE


# ============== Piper Neural TTS Setup ==============
_PIPER_MODEL_PATHS = [
    Path(__file__).parent / "en_US-ryan-medium.onnx",
    Path(__file__).parent / "en_US-lessac-medium.onnx",
]
_piper_voice = None
_tts_executor = ThreadPoolExecutor(
    max_workers=min(4, os.cpu_count() or 2),
    thread_name_prefix="tts_worker",
)
_TTS_CACHE_MAX_SIZE = 300
_tts_cache: OrderedDict[str, bytes] = OrderedDict()
_tts_cache_lock = asyncio.Lock()

def _load_piper_model():
    global _piper_voice
    model_path = next((p for p in _PIPER_MODEL_PATHS if p.exists()), None)
    if model_path is not None:
        try:
            from piper import PiperVoice
            _piper_voice = PiperVoice.load(model_path)
            print(f"[INFO] Piper TTS model warm-loaded successfully from {model_path.name}.")
        except Exception as e:
            print(f"[WARN] Failed to load Piper TTS model: {e}")
    else:
        print("[WARN] No Piper model file found in project directory.")

def _synthesize_piper_wav(text: str) -> bytes:
    """CPU-bound task executed inside dedicated thread pool."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        _piper_voice.synthesize_wav(text, wav_file)
    return buf.getvalue()


# ============== Lifespan ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    _load_piper_model()
    yield
    global _WORKSPACE_CLIENTS
    _WORKSPACE_CLIENTS.clear()
    # Shutdown all active SessionLoops so their SDK clients disconnect cleanly.
    for loop in list(_SESSION_REGISTRY.values()):
        try:
            await loop.shutdown()
        except Exception:
            pass
    _SESSION_REGISTRY.clear()
    _tts_executor.shutdown(wait=False)


app = FastAPI(title="QA Automation Chatbot", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if (_FE_DIST_PATH / "assets").exists():
    app.mount("/assets", StaticFiles(directory=_FE_DIST_PATH / "assets"), name="assets")


# ponytail: serve the PWA shell assets from dist/ root. StaticFiles on "/" would
# shadow the rest of the routes, so explicit FileResponse per file is the
# smallest correct change. MIME for .webmanifest is set explicitly because some
# proxies guess it wrong; Chrome's installability check rejects bad MIME.
_PWA_SHELL = {
    "/manifest.webmanifest": "application/manifest+json",
    "/sw.js": "application/javascript",
    "/icon.svg": "image/svg+xml",
    "/icon-192.png": "image/png",
    "/icon-512.png": "image/png",
    "/apple-touch-icon.png": "image/png",
}

for _route, _mime in _PWA_SHELL.items():
    _file = _FE_DIST_PATH / _route.lstrip("/")
    if _file.exists():
        async def _serve(_path=_file, _media=_mime):
            return FileResponse(_path, media_type=_media)
        app.add_api_route(_route, _serve, methods=["GET"], include_in_schema=False)

# Per-workspace SDK client cache (legacy /api/chat; new SessionLoop owns the long-lived clients)
_WORKSPACE_CLIENTS: dict[str, ClaudeSDKClient] = {}
_cache_lock = asyncio.Lock()
_session_locks: dict[str, asyncio.Lock] = {}
# ponytail: per-(workspace, setting_sources) slash-command cache. The SDK's
# command surface is invariant for a given scope, so the first session to
# broadcast in a (workspace, scope) pair populates this and every subsequent
# session with the same pair reads it on SSE-connect without paying for
# another `get_server_info()`. Keyed by tuple(workspace, sorted(setting_sources))
# — or (workspace, None) when the FE didn't declare a scope. Without the
# per-scope key, a session that opened with `["user"]` would silently show
# the cached `["local"]` list (or vice versa).
_WORKSPACE_COMMANDS_CACHE: dict[tuple, list] = {}


def _ss_cache_key(setting_sources: list | None) -> tuple | None:
    """Hashable cache key for a setting_sources list. None ⇒ SDK defaults."""
    if not setting_sources:
        return None
    return tuple(sorted(setting_sources))


def _parse_setting_sources_query(raw: str | None) -> list | None:
    """Parse the JSON-encoded `setting_sources` query string from the FE.
    Returns None on any failure — invalid input falls back to SDK defaults
    rather than 400-ing the SSE connect (EventSource can't recover from HTTP
    errors gracefully)."""
    if not raw:
        return None
    try:
        v = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        return None
    return v

# Per-session background-task registry for true streaming-input mode
_SESSION_REGISTRY: dict[str, "SessionLoop"] = {}
_registry_lock = asyncio.Lock()
_SESSION_IDLE_TIMEOUT = 30 * 60  # seconds; ponytail: simple global, configurable later


class _UserMessage(BaseModel):
    content: str
    images: list[dict] | None = None  # Phase 6: [{data, media_type}] base64
    # Session-startup settings. The BE locks these in on the first message
    # (the SDK client is built lazily and only initializes once per session).
    # Subsequent messages in the same session send these but the BE ignores
    # them — the agent's system_prompt / skill set / permission mode cannot
    # be changed mid-stream without tearing down the SDK client.
    setting_sources: list[SettingSource] | None = None
    skills: list[str] | Literal["all"] | None = None
    permission_mode: Literal["read_only", "bypassPermissions", "plan"] | None = None


class SessionLoop:
    """Owns one ClaudeSDKClient, one incoming queue, N subscriber queues."""

    def __init__(self, workspace: str, session_id: str):
        self.workspace = workspace
        self.session_id = session_id
        self._client: ClaudeSDKClient | None = None
        self._incoming: asyncio.Queue[_UserMessage] = asyncio.Queue()
        self._subscribers: set[asyncio.Queue] = set()
        self._running = False
        self._task: asyncio.Task | None = None
        self._last_activity = asyncio.get_event_loop().time()
        # Per-loop translator state — translates SDK StreamEvent/ResultMessage into the same
        # legacy event shape (/api/chat emits). Mirrors the legacy response_reader logic.
        self._pending_tools: dict[int, dict] = {}
        self._turn_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        # Settings locked in on the first message. None until then, then a
        # frozen dict the SDK client is built with. Late messages with new
        # settings are ignored — the client is already running with the locked
        # set, and rebuilding would lose the conversation context.
        self._locked_settings: dict | None = None
        # ponytail: FE permission_mode changes must take effect on the next
        # tool call, not the next session. _locked_settings freezes the *client
        # build*, but the user can still tighten/loosen per-tool access live —
        # can_use_tool reads this and denies out-of-scope tools when read_only.
        # Updated on every enqueued message, distinct from the build-time lock.
        self._current_permission_mode: str | None = None
        # ponytail: SSE Last-Event-ID replay buffer. Monotonic per-session id is
        # assigned in _broadcast; the deque is the bounded ring the spec assumes.
        # maxlen=2000 caps memory at ~4MB / session for typical text_delta payloads.
        # Long bash tool outputs may consume more; the messages-API catch-up
        # covers the resulting gap (reducer dedupes).
        self._event_seq: int = 0
        self._event_buffer: collections.deque = collections.deque(maxlen=2000)
        # ponytail: cache of the SDK's slash command list, populated by
        # ensure_commands_broadcast(). The slash palette is a UI expectation
        # on session open (before the first user turn), so the cache is
        # populated eagerly on SSE connect, not lazily on first message.
        self._cached_commands: list | None = None

    async def _commands_from_client(self, client) -> list:
        # ponytail: shared extractor — used by both the SSE-open broadcast
        # and the per-turn re-broadcast in _loop_body. Pure read of the
        # SDK's cached _initialization_result, no extra round-trip.
        try:
            info = await client.get_server_info()
        except Exception as e:
            print(f"[WARN] get_server_info failed: {e}")
            return []
        if not info or not isinstance(info.get("commands"), list):
            return []
        return [
            {
                "name": c.get("name"),
                "description": c.get("description", "") or "",
                "argumentHint": c.get("argumentHint", "") or "",
            }
            for c in info["commands"]
            if c.get("name")
        ]

    async def ensure_commands_broadcast(
        self,
        setting_sources: list | None = None,
        skills: list | Literal["all"] | None = None,
    ):
        # ponytail: SSE-open entry point. The slash-command palette is a
        # page-load expectation — users type `/` to discover commands, not
        # after sending a first message. So we broadcast the list on every
        # SSE connect, not only inside _loop_body.
        #
        # The cache is keyed by (workspace, setting_sources) — NOT just
        # workspace — because the SDK's command surface depends on which
        # scopes are loaded. Two sessions in the same workspace with
        # different setting_sources get different command lists; without
        # per-scope keying, a session opened with `["user"]` would silently
        # inherit the cached list from a previous `["local"]` session.
        #
        # The FE passes its current setting_sources on SSE-open (same value
        # it stores in localStorage and will send on the first message), so
        # the broadcast client is built with the SAME scope the per-turn
        # client will be built with. When the first message arrives, the
        # per-turn re-broadcast at the end of _loop_body re-validates with
        # the locked settings (safety net for any drift between localStorage
        # and the first message body).
        cache_key = (self.workspace, _ss_cache_key(setting_sources))
        cached = _WORKSPACE_COMMANDS_CACHE.get(cache_key)
        if cached is not None:
            self._cached_commands = cached
            await self._broadcast({"type": "commands_available", "commands": cached})
            return
        if self._client is None:
            # Build with the FE's declared scope so the broadcast matches
            # what the per-turn client will be built with on the first message.
            self._client = await self._build_client(
                None, setting_sources=setting_sources, skills=skills
            )
        cmds = await self._commands_from_client(self._client)
        if cmds:
            _WORKSPACE_COMMANDS_CACHE[cache_key] = cmds
            self._cached_commands = cmds
            await self._broadcast({"type": "commands_available", "commands": cmds})

    def _touch(self):
        self._last_activity = asyncio.get_event_loop().time()

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._loop_body())
        asyncio.create_task(self._idle_watcher())
        asyncio.create_task(self._context_usage_ticker())

    async def enqueue(self, msg: _UserMessage):
        self._touch()
        await self._incoming.put(msg)

    def subscribe(self) -> asyncio.Queue:
        # ponytail: unbounded — when the FE falls behind, broadcast must NEVER drop.
        # The previous maxsize=1024 silently lost text_deltas / done on slow renders
        # (queue filled, put_nowait raised QueueFull, `pass` swallowed the event).
        # Bounded in practice by events-per-turn (a few MB at most).
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(q)
        self._touch()
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.discard(q)
        self._touch()

    async def interrupt(self):
        # ponytail: resolve dangling permission futures BEFORE we cancel the
        # reader task — otherwise the agent's `wait_for(fut)` is cancelled mid-
        # flight and the future sits in _permission_futures until the 300s
        # timeout. Mirrors the legacy /api/chat finally block.
        self._resolve_pending_permissions("deny", "Session interrupted")
        if self._client is not None:
            try:
                await self._client.interrupt()
            except Exception as e:
                print(f"[WARN] interrupt failed: {e}")

    async def shutdown(self):
        self._running = False
        self._resolve_pending_permissions("deny", "Session ended")
        if self._task and not self._task.done():
            self._task.cancel()
        if self._client is not None:
            try:
                await self._client.disconnect()
            except Exception:
                pass
            self._client = None

    def _resolve_pending_permissions(self, decision: str, message: str):
        """Resolve every pending permission future for this session and pop it
        from the dict immediately so the next user action doesn't pick up a
        stale request. The can_use_tool callback's `finally` block will see
        an empty slot and skip the duplicate pop."""
        for key, fut in list(_permission_futures.items()):
            if key[0] != self.session_id or fut.done():
                continue
            try:
                fut.set_result({"decision": decision, "message": message})
            except Exception as e:
                print(f"[WARN] failed to resolve permission {key}: {e}")
            _permission_futures.pop(key, None)
            _permission_meta.pop(key, None)

    async def _broadcast(self, event):
        # Accept either a dict (already in FE event shape) or an SDK Message object.
        from fastapi.encoders import jsonable_encoder
        if not isinstance(event, dict):
            try:
                event = jsonable_encoder(event)
            except Exception:
                event = {"type": "_sdk_raw", "message": str(event)}
        # ponytail: assign monotonic id, buffer (eid, event), push tuple to subscribers.
        # Same eid flows through buffer + sub_q + SSE frame so replay and live tail
        # share a stable id end-to-end.
        self._event_seq += 1
        eid = self._event_seq
        self._event_buffer.append((eid, event))
        for sub in list(self._subscribers):
            try:
                sub.put_nowait((eid, event))
            except asyncio.QueueFull:
                pass  # ponytail: drop slow subscriber
        self._touch()

    def _make_generator(self, msg: _UserMessage):
        async def gen():
            content: Any = msg.content
            if msg.images:
                blocks: list[dict] = [{"type": "text", "text": msg.content}]
                for img in msg.images:
                    blocks.append({"type": "image", "source": {"type": "base64", "media_type": img["media_type"], "data": img["data"]}})
                content = blocks
            yield {"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None, "session_id": self.session_id}
        return gen()

    def _make_can_use_tool(self):
        loop_ref = self

        async def can_use_tool(tool_name: str, tool_input: dict, context: ToolPermissionContext):
            print(f"[PERM_HOOK] {self.session_id} tool={tool_name} mode={loop_ref._current_permission_mode!r}", flush=True)
            # ponytail: the sole permission authority for the live session. The
            # SDK client is built once with all tools available and no
            # --permission-mode flag, so the CLI ships its full toolset and
            # asks us about every dangerous call. Three modes:
            #   - bypassPermissions: allow immediately, no FE dialog. The
            #     "Full Access" toggle in the UI.
            #   - read_only: deny anything outside the read-only allowlist,
            #     no dialog. Live flips in either direction work because the
            #     CLI's toolset was never narrowed.
            #   - None / default: fall through to the FE permission dialog
            #     (the historical behavior).
            mode = loop_ref._current_permission_mode
            if mode == "bypassPermissions":
                print(f"[PERM] {self.session_id} allow {tool_name} (bypassPermissions)")
                return PermissionResultAllow(updated_input=tool_input)
            if mode == "read_only" and tool_name not in _READ_ONLY_TOOLS:
                print(f"[PERM] {self.session_id} deny {tool_name} (read_only)")
                return PermissionResultDeny(message=f"Tool '{tool_name}' is blocked: session is in read-only mode")
            request_id = context.tool_use_id or f"perm_{uuid.uuid4().hex}"
            fut: asyncio.Future = asyncio.Future()
            _permission_futures[(self.session_id, request_id)] = fut
            _permission_meta[(self.session_id, request_id)] = {
                "tool_name": tool_name,
                "tool_input": tool_input,
                "session_id": self.session_id,
                "request_id": request_id,
            }
            await loop_ref._broadcast({
                "type": "permission_request",
                "request_id": request_id,
                "session_id": self.session_id,
                "tool_name": tool_name,
                "tool_input": tool_input,
                "tool_use_id": context.tool_use_id,
                "title": context.title,
                "description": context.description,
                "suggestions": [s.to_dict() for s in (context.suggestions or [])],
            })
            try:
                result = await asyncio.wait_for(fut, timeout=300)
            except asyncio.TimeoutError:
                result = {"decision": "deny", "message": "Permission request timed out"}
            finally:
                _permission_futures.pop((self.session_id, request_id), None)
                _permission_meta.pop((self.session_id, request_id), None)
            await loop_ref._broadcast({
                "type": "permission_resolved",
                "request_id": request_id,
                "session_id": self.session_id,
                "decision": result["decision"],
            })
            decision = result["decision"]
            if decision == "allow":
                if tool_name == "AskUserQuestion" and result.get("answers") is not None:
                    return PermissionResultAllow(updated_input={
                        "questions": tool_input.get("questions", []),
                        "answers": result["answers"],
                    })
                updated = result.get("updated_input")
                if tool_name in {"Edit", "Bash", "Write", "NotebookEdit"} and updated is None:
                    print(f"[WARN] {tool_name} approved without updated_input; FE may have discarded edits")
                # ponytail: SDK accepts dict | None; force None to dict when user passed nothing useful
                final_input: dict | None = updated if isinstance(updated, dict) else tool_input
                return PermissionResultAllow(updated_input=final_input)
            return PermissionResultDeny(message=result.get("message", "User denied"))

        return can_use_tool

    async def _build_client(
        self,
        mode: str | None,
        *,
        setting_sources: list | None = None,
        skills: list | Literal["all"] | None = None,
    ) -> ClaudeSDKClient:
        # ponytail: build the SDK client for a specific FE mode. The toolset is
        # baked at launch — to switch modes live we disconnect this client and
        # reconnect with new options (see _loop_body). --resume carries the
        # same session_id through, so the Claude API session and JSONL file
        # stay continuous.
        #
        # setting_sources/skills overrides: if neither is passed, fall through
        # to the locked settings captured on the first message. ensure_commands_broadcast
        # passes explicit values so the broadcast client is built with the FE's
        # declared scope BEFORE the first message locks anything in. After the
        # first message, the per-turn rebuild uses _locked_settings.
        if setting_sources is None and skills is None:
            s = self._locked_settings or {}
            setting_sources = s.get("setting_sources")
            skills = s.get("skills")
        project_key = _sdk_project_key(self.workspace)
        jsonl_path = Path.home() / ".claude" / "projects" / project_key / f"{self.session_id}.jsonl"
        opts = _build_options(
            workspace=self.workspace,
            session_id=self.session_id,
            resume=jsonl_path.exists(),
            setting_sources=setting_sources,
            skills=skills,
            permission_mode=mode,
        )
        client = ClaudeSDKClient(options=opts)
        await client.connect()
        return client

    async def _loop_body(self):
        # Track JSONL growth for this session so we can extract tool results after each turn.
        project_key = _sdk_project_key(self.workspace)
        jsonl_path = Path.home() / ".claude" / "projects" / project_key / f"{self.session_id}.jsonl"

        while self._running:
            msg = await self._incoming.get()
            # Lock session-startup settings on the first message. Subsequent
            # messages carry the same fields but the client is already running,
            # so we deliberately don't rebuild those — only the permission
            # mode may change.
            if self._locked_settings is None:
                self._locked_settings = {
                    "setting_sources": msg.setting_sources,
                    "skills": msg.skills,
                }
            # ponytail: live permission switch. The toolset is launch-time in
            # the SDK, so a mode flip means respawning the subprocess with
            # --resume <session_id>. The conversation history and CLI's view
            # of the session are preserved by the resume; the agent's
            # in-memory state goes, but the next turn re-sees the full JSONL.
            target_mode = msg.permission_mode
            mode_changed = (
                self._client is None
                or getattr(self, "_current_permission_mode", None) != target_mode
            )
            if mode_changed:
                if self._client is not None:
                    try:
                        await self._client.disconnect()
                    except Exception:
                        pass
                    self._client = None
                print(f"[PERM] {self.session_id} fe_mode={target_mode!r} -> respawn")
                self._client = await self._build_client(target_mode)
            self._current_permission_mode = target_mode
            # ponytail: re-broadcast the SDK's command surface every turn so
            # FE SSE reconnects that skip the replay buffer still get the
            # list. ensure_commands_broadcast is idempotent (cached list
            # reused) — re-broadcasts are cheap and safe. We pass the
            # LOCKED settings (not the SSE-open query value) so the cache
            # key is keyed by what the per-turn client is actually running
            # with, defending against any drift between localStorage and
            # the first message body.
            locked = self._locked_settings or {}
            await self.ensure_commands_broadcast(
                setting_sources=locked.get("setting_sources"),
                skills=locked.get("skills"),
            )
            # Reset per-turn state so each enqueued user message starts fresh.
            self._pending_tools = {}
            self._turn_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
            jsonl_size_before = jsonl_path.stat().st_size if jsonl_path.exists() else 0
            try:
                # ponytail: _build_client / respawn above guarantees _client is
                # non-None here; the `assert` is a no-op at runtime and quiets
                # the type checker.
                assert self._client is not None
                await self._client.query(self._make_generator(msg), session_id=self.session_id)
                async for sdk_event in self._client.receive_response():
                    for legacy in self._translate_sdk_message(sdk_event, jsonl_path, jsonl_size_before):
                        await self._broadcast(legacy)
                # Per-turn context snapshot at the result-message boundary. Same
                # shape as the 10s ticker; the FE reducer handles both with one
                # branch. _translate_sdk_message is sync, so the snapshot can't
                # live inside the `done` yield — broadcast it here, after
                # receive_response() drains.
                try:
                    ctx = await self._client.get_context_usage()
                    await self._broadcast({"type": "context_usage", "data": ctx})
                except Exception as e:
                    print(f"[WARN] per-turn context usage snapshot failed: {e}")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[ERROR] SessionLoop {self.session_id}: {e}")
                await self._broadcast({"type": "error", "message": str(e), "session_id": self.session_id})
                if self._client is not None:
                    try:
                        await self._client.disconnect()
                    except Exception:
                        pass
                    self._client = None

    def _translate_sdk_message(self, sdk_event, jsonl_path, jsonl_size_before):
        """Mirror legacy /api/chat response_reader: turn SDK events into the legacy event dicts
        the frontend already understands (text_delta, thinking_delta, tool_result, done, ...).
        Yields zero or more legacy event dicts."""
        # AssistantMessage — final text/thinking content for this turn (e.g. "API Error: ..."
        # arrives as AssistantMessage, not StreamEvent delta — stream it so FE sees it live).
        from claude_agent_sdk import SystemMessage
        if isinstance(sdk_event, SystemMessage):
            # ponytail: the SDK yields a system/init SystemMessage at session
            # start. data.slash_commands is a list of bare command NAMES (no
            # description, no argumentHint) — empirically verified against
            # claude_agent_sdk 0.1.x. The rich {name, description, argumentHint}
            # shape the palette needs comes from get_server_info() (the cached
            # control-request response), not from this system message. So we
            # deliberately don't broadcast. The translator still needs to
            # acknowledge the type so a future subtype that we DO care about
            # doesn't fall through to the unhandled tail.
            return
        from claude_agent_sdk import AssistantMessage, TextBlock
        if isinstance(sdk_event, AssistantMessage):
            # Only emit TextBlock from AssistantMessage when it looks like an error —
            # normal text is already streamed via StreamEvent before this arrives.
            for block in sdk_event.content:
                if isinstance(block, TextBlock) and block.text:
                    if "API Error" in block.text or "error" in block.text.lower():
                        yield {"type": "text_delta", "content": block.text}
            return
        # StreamEvent with delta payloads.
        if isinstance(sdk_event, StreamEvent):
            evt = sdk_event.event
            evt_type = evt.get("type")
            if evt_type == "content_block_delta":
                delta = evt.get("delta", {})
                d_type = delta.get("type")
                if d_type == "text_delta":
                    yield {"type": "text_delta", "content": delta.get("text", "")}
                    return
                if d_type == "thinking_delta":
                    yield {"type": "thinking_delta", "content": delta.get("thinking", "")}
                    return
                if d_type == "input_json_delta":
                    idx = evt.get("index")
                    partial = delta.get("partial_json", "")
                    if idx in self._pending_tools:
                        self._pending_tools[idx]["args_str"] += partial
                    return
                return
            if evt_type == "content_block_start":
                cb = evt.get("content_block", {})
                if cb.get("type") == "tool_use":
                    idx = evt.get("index")
                    if idx is not None:
                        self._pending_tools[idx] = {
                            "name": cb.get("name"),
                            "id": cb.get("id"),
                            "args_str": "",
                        }
                return
            if evt_type == "message_delta":
                usage = evt.get("usage", {})
                if usage:
                    self._turn_usage["input_tokens"] += usage.get("prompt_tokens", 0)
                    self._turn_usage["output_tokens"] += usage.get("completion_tokens", 0)
                    self._turn_usage["total_tokens"] = (
                        self._turn_usage["input_tokens"] + self._turn_usage["output_tokens"]
                    )
                return
            if evt_type in ("content_block_stop", "message_start"):
                return
            if evt_type == "message_stop":
                # One tool_result per pending tool. Result content comes from JSONL tail afterwards.
                for idx, tool_data in self._pending_tools.items():
                    args_str = tool_data.get("args_str", "")
                    try:
                        args_json = json.loads(args_str) if args_str else {}
                    except json.JSONDecodeError:
                        args_json = {}
                    yield {
                        "type": "tool_result",
                        "tool_name": tool_data["name"],
                        "tool_id": tool_data["id"],
                        "args": args_json,
                    }
                self._pending_tools = {}
                return
            return

        # ResultMessage — final per-turn result.
        if isinstance(sdk_event, ResultMessage):
            try:
                if sdk_event.model_usage and self._turn_usage["total_tokens"] == 0:
                    for model, u in sdk_event.model_usage.items():
                        self._turn_usage["input_tokens"] += u.get("inputTokens", 0)
                        self._turn_usage["output_tokens"] += u.get("outputTokens", 0)
                    self._turn_usage["total_tokens"] = (
                        self._turn_usage["input_tokens"] + self._turn_usage["output_tokens"]
                    )
                elif sdk_event.usage and self._turn_usage["total_tokens"] == 0:
                    self._turn_usage["input_tokens"] = sdk_event.usage.get("input_tokens", 0)
                    self._turn_usage["output_tokens"] = sdk_event.usage.get("output_tokens", 0)
                    self._turn_usage["total_tokens"] = sdk_event.usage.get("total_tokens", 0)
            except Exception:
                pass

            # Schedule JSONL tail after we return so the broadcast queue isn't blocked.
            asyncio.create_task(self._tail_jsonl_for_tool_results(jsonl_path, jsonl_size_before))

            yield {
                "type": "done",
                "thread_id": self.session_id,
                "usage": self._turn_usage if self._turn_usage["total_tokens"] > 0 else None,
            }
            return

    async def _tail_jsonl_for_tool_results(self, jsonl_path, jsonl_size_before):
        """Tail the JSONL session file for tool_result blocks emitted since last 'done'.
        Each result gets broadcast as a tool_result_content event for the matching tool_id."""
        try:
            if not jsonl_path.exists():
                return
            with open(jsonl_path, "rb") as f:
                f.seek(jsonl_size_before)
                new_bytes = f.read()
            if not new_bytes.strip():
                return
            for line in new_bytes.split(b"\n"):
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line.decode("utf-8", errors="replace"))
                except Exception:
                    continue
                if entry.get("type") != "user":
                    continue
                msg_content = entry.get("message", {}).get("content", [])
                if not isinstance(msg_content, list):
                    continue
                for block in msg_content:
                    if block.get("type") != "tool_result":
                        continue
                    tool_result = block.get("content", "")
                    text_parts = []
                    if isinstance(tool_result, list):
                        for item in tool_result:
                            if isinstance(item, dict) and item.get("type") == "text":
                                text_parts.append(item.get("text", ""))
                    content = "".join(text_parts) if text_parts else str(tool_result)
                    source_uuid = entry.get("sourceToolAssistantUUID", "")
                    if content:
                        await self._broadcast({
                            "type": "tool_result_content",
                            "tool_id": source_uuid,
                            "content": content,
                        })
        except Exception as e:
            print(f"[WARN] JSONL tail failed: {e}")

    async def _idle_watcher(self):
        while self._running:
            await asyncio.sleep(60)
            now = asyncio.get_event_loop().time()
            if now - self._last_activity > _SESSION_IDLE_TIMEOUT and not self._subscribers and self._incoming.qsize() == 0:
                await self.shutdown()
                async with _registry_lock:
                    _SESSION_REGISTRY.pop(self.session_id, None)
                return

    async def _context_usage_ticker(self):
        """Periodic context snapshot — every 10s while the session is alive.
        Same shape as the per-turn snapshot in `done`; the FE reducer handles
        both with one branch."""
        while self._running:
            await asyncio.sleep(10)
            if self._client is None:
                continue
            try:
                ctx = await self._client.get_context_usage()
                await self._broadcast({"type": "context_usage", "data": ctx})
            except Exception as e:
                print(f"[WARN] context usage poll failed: {e}")


async def get_or_create_loop(workspace: str, session_id: str) -> SessionLoop:
    async with _registry_lock:
        loop = _SESSION_REGISTRY.get(session_id)
        if loop is None:
            loop = SessionLoop(workspace=workspace, session_id=session_id)
            _SESSION_REGISTRY[session_id] = loop
            await loop.start()
        return loop


async def _session_lock(sid: str) -> asyncio.Lock:
    async with _cache_lock:
        lk = _session_locks.get(sid)
        if lk is None:
            lk = asyncio.Lock()
            _session_locks[sid] = lk
        return lk


# ============== SDK Helpers ==============

def _sdk_project_key(workspace: str) -> str:
    """Compute SDK project-key from workspace path."""
    # The SDK replaces '.' with '-' in path components when building the key
    return "-" + os.path.realpath(workspace).lstrip("/").replace("/", "-").replace(".", "-")


def _read_sdk_history(
    workspace: str,
    session_id: str,
    start_offset: int = 0,
    limit: int | None = None,
) -> tuple[list[dict], int | None]:
    """Read conversation history from SDK JSONL file.

    Returns messages in chronological order (oldest first), suitable for a chat UI.

    - First load (cursor=None): returns the most recent `limit` messages.
      next_cursor = byte offset of the first message in that page.
    - Load more (cursor=<byte>): returns `limit` messages BEFORE that byte position.
      next_cursor = byte offset of the first message in that page, or None if at the start.
    """
    project_key = _sdk_project_key(workspace)
    jsonl_path = Path.home() / ".claude" / "projects" / project_key / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return [], None

    # Read full file and build entries with byte positions
    with open(jsonl_path, "rb") as f:
        raw = f.read()
    lines = raw.split(b"\n")
    entries: list[tuple[int, dict]] = []
    pos = 0
    for line in lines:
        if line.strip():
            try:
                entries.append((pos, json.loads(line.decode("utf-8", errors="replace"))))
            except Exception:
                pass
        pos += len(line) + 1

    if not entries:
        return [], None

    pending_tool_calls: dict[str, dict] = {}
    pending_speech_explanation: str | None = None

    def parse_entries(
        ents: list[tuple[int, dict]],
    ) -> tuple[list[dict], list[int]]:
        """Parse entries into logical messages and track each message's source byte offset.

        Returns (messages, byte_offsets) where byte_offsets[i] is the byte_pos of
        entries[i]. Each logical message (human, ai, thinking, tool) gets the byte
        offset of its parent entry.

        byte_offsets is built in parallel with messages by counting how many messages
        each entry produces, so they always stay in sync.
        """
        messages: list[dict] = []
        byte_offsets: list[int] = []
        pending_tool_calls.clear()
        pending_speech_explanation = None

        for byte_pos, entry in ents:
            entry_type = entry.get("type", "")

            if entry_type == "user":
                msg = entry.get("message", {})
                msg_content = msg.get("content", [])
                if isinstance(msg_content, str):
                    msg_content = [{"type": "text", "text": msg_content}]
                if isinstance(msg_content, list):
                    has_tool_result = any(c.get("type") == "tool_result" for c in msg_content)
                    if has_tool_result:
                        for block in msg_content:
                            if block.get("type") == "tool_result":
                                tool_result = block.get("content", "")
                                text_parts = []
                                if isinstance(tool_result, list):
                                    for item in tool_result:
                                        if isinstance(item, dict):
                                            if item.get("type") == "text":
                                                text_parts.append(item.get("text", ""))
                                            elif item.get("type") == "image":
                                                text_parts.append("[Image Output]")
                                        elif isinstance(item, str):
                                            text_parts.append(item)
                                tool_result = "\n".join(text_parts) if text_parts else str(tool_result)
                                source_uuid = entry.get("sourceToolAssistantUUID")
                                if source_uuid and source_uuid in pending_tool_calls:
                                    tool_call = pending_tool_calls.pop(source_uuid)
                                    tool_name = tool_call["name"]
                                    if tool_name == "StructuredOutput":
                                        try:
                                            parsed = json.loads(tool_result)
                                            explanation = parsed.get("explanation", "") if isinstance(parsed, dict) else ""
                                        except (json.JSONDecodeError, TypeError):
                                            explanation = str(tool_result)
                                        if explanation:
                                            pending_speech_explanation = explanation
                                            if messages and messages[-1]["type"] == "ai":
                                                messages[-1]["speech_explanation"] = pending_speech_explanation
                                                pending_speech_explanation = None
                                    else:
                                        messages.append({
                                            "type": "tool",
                                            "name": tool_name,
                                            "input": tool_call["input"],
                                            "content": tool_result,
                                        })
                                        byte_offsets.append(byte_pos)
                    else:
                        text_blocks = [c for c in msg_content if c.get("type") == "text"]
                        image_blocks = [c for c in msg_content if c.get("type") == "image"]
                        human_text = "".join(c.get("text", "") for c in text_blocks)
                        if human_text and not human_text.startswith("[structured-output-enforce]") and not human_text.startswith("Stop hook feedback:"):
                            human_msg = {"type": "human", "content": human_text}
                            if image_blocks:
                                # SDK stores images in the same {data, media_type} shape we
                                # send over the wire — mirror it so reloads keep thumbnails.
                                human_msg["images"] = [
                                    {
                                        "data": img["source"]["data"],
                                        "media_type": img["source"]["media_type"],
                                    }
                                    for img in image_blocks
                                    if img.get("source", {}).get("type") == "base64"
                                ]
                            messages.append(human_msg)
                            byte_offsets.append(byte_pos)

            elif entry_type == "assistant":
                msg = entry.get("message", {})
                msg_content = msg.get("content", [])
                if isinstance(msg_content, list):
                    texts = []
                    thinking_content = None
                    speech_explanation = None
                    for block in msg_content:
                        if block.get("type") == "text":
                            texts.append(block.get("text", ""))
                        elif block.get("type") == "tool_use":
                            tool_name = block.get("name")
                            tool_input = block.get("input", {})
                            assistant_uuid = entry.get("uuid")
                            if tool_name == "StructuredOutput":
                                speech_explanation = tool_input.get("explanation", "")
                            elif assistant_uuid and tool_name:
                                pending_tool_calls[assistant_uuid] = {
                                    "name": tool_name,
                                    "input": tool_input,
                                }
                        elif block.get("type") == "thinking":
                            thinking_content = block.get("thinking", "")
                    if texts:
                        ai_msg = {"type": "ai", "content": "".join(texts)}
                        if speech_explanation:
                            ai_msg["speech_explanation"] = speech_explanation
                        messages.append(ai_msg)
                        byte_offsets.append(byte_pos)
                    elif speech_explanation:
                        # StructuredOutput-only response (no text block)
                        messages.append({"type": "ai", "content": speech_explanation, "speech_explanation": speech_explanation})
                        byte_offsets.append(byte_pos)
                    if thinking_content:
                        messages.append({"type": "thinking", "content": thinking_content})
                        byte_offsets.append(byte_pos)

        return messages, byte_offsets

    if limit is None:
        messages, _ = parse_entries(entries)
        return messages, None

    # --- First load (no cursor): return most recent `limit` messages ---
    if start_offset == 0:
        all_messages, all_byte_offsets = parse_entries(entries)
        if len(all_messages) <= limit:
            return all_messages, None

        # Find the byte offset of the message at index [len - limit]
        first_msg_in_recent = len(all_messages) - limit
        first_byte = all_byte_offsets[first_msg_in_recent]
        return all_messages[-limit:], first_byte

    # --- Load more (cursor provided): return `limit` messages BEFORE cursor ---
    older_entries = [(bp, e) for bp, e in entries if bp < start_offset]
    if not older_entries:
        return [], None

    older_messages, older_byte_offsets = parse_entries(older_entries)

    if len(older_messages) <= limit:
        return older_messages, None  # reached the beginning

    first_msg_in_page = len(older_messages) - limit
    first_byte = older_byte_offsets[first_msg_in_page]
    return older_messages[-limit:], first_byte




SPEECH_EXPLANATION_SYSTEM_PROMPT = """After your response, produce a StructuredOutput with a spoken explanation.

CRITICAL RULES FOR THIS SPOKEN EXPLANATION:
1. TARGET AUDIENCE IS LISTENING, NOT READING: This text will be fed directly into a text-to-speech synthesizer and played aloud to the user's ears. Write it entirely as natural, conversational spoken narration.
2. ABSOLUTELY NO MARKDOWN: Do NOT include any asterisks, bold markers, italics, bullet points, hashtags, headers, numbered lists, or backticks. Zero markdown formatting.
3. ABSOLUTELY NO CODE OR SYNTAX SYMBOLS: Never write raw code, programming symbols, variable names with underscores, function signatures, or SQL queries (e.g. no 'SELECT *', 'exp.Select', '_walk()', 'foo_bar', brackets, or parentheses). Instead, explain all technical concepts and operations in plain, everyday conversational English (for example, say "the select expression" or "the recursive traversal function").
4. CONTINUOUS SPOKEN PARAGRAPHS: Write in smooth, flowing natural paragraphs. Use conversational speech transitions ("To understand how this works...", "Next, let us look at...", "What this really means in practice is...") and clear everyday analogies.
5. COMPLETE AND ENGAGING: Walk through the core concept, the step-by-step logic, and why it matters, as if an expert tutor is explaining it aloud over a voice call."""

SYSTEM_PROMPT_EXPLANATION_SCHEMA = {
    "type": "json_schema",
    "schema": {
        "type": "object",
        "properties": {
            "explanation": {
                "type": "string",
                "description": "A natural, spoken-word voice script for text-to-speech audio playback. Must be written in 100% plain conversational English paragraphs with zero markdown, zero code snippets, and zero syntax symbols. Explains all technical concepts, logic, and significance verbally as if speaking aloud to a student on a phone call."
            }
        },
        "required": ["explanation"],
    },
}

# Read-only tool set applied when permission_mode == "read_only". These tools
# are the only ones available to the agent — no Bash, Write, Edit, MultiEdit,
# or NotebookEdit can be called.
_READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebFetch", "WebSearch"]
# Tools explicitly denied when permission_mode == "read_only". The CLI honors
# disallowedTools and will not even let the agent *try* to call them, so the
# plan-mode trick (turning Bash into a plan entry) is no longer needed.
_READ_ONLY_DISALLOWED = ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"]


# ponytail: per-mode profile for the SDK. Each entry is the SDK's
# permission_mode string plus the toolset the CLI should expose. read_only is
# NOT mapped to plan mode (plan is a workflow, not a restriction — it would
# still let read-only bash through and let the agent write to its own plan
# file). The tool whitelist is the only thing that actually blocks Bash in
# read_only.
_MODE_PROFILES: dict[str | None, tuple[str | None, list[str] | None, list[str] | None]] = {
    None:                ("default",          None, None),
    "default":           ("default",          None, None),
    "bypassPermissions": ("bypassPermissions", None, None),
    "read_only":         (None,               list(_READ_ONLY_TOOLS), list(_READ_ONLY_DISALLOWED)),
    "plan":              ("plan",             None, None),
}


def _resolve_mode_profile(fe_mode: str | None) -> tuple[str | None, list[str] | None, list[str] | None]:
    """Return (sdk_permission_mode, allowed_tools, disallowed_tools) for an FE mode.
    Unknown values fall back to default so a typo can't silently widen access."""
    return _MODE_PROFILES.get(fe_mode, _MODE_PROFILES[None])

def _build_options(
    workspace: str,
    session_id: str | None = None,
    resume: bool = False,
    system_prompt: str | None = None,
    setting_sources: list[SettingSource] | None = None,
    skills: list[str] | Literal["all"] | None = None,
    permission_mode: str | None = None,
) -> ClaudeAgentOptions:
    # ponytail: SDK hangs when skills=[] (empty list); coerce to None so it uses defaults.
    if skills == []:
        skills = None
    sdk_mode, allowed_tools, disallowed_tools = _resolve_mode_profile(permission_mode)
    print(
        f"[SDK_OPTS] session_id={session_id} setting_sources={setting_sources} skills={skills} "
        f"fe_mode={permission_mode!r} sdk_mode={sdk_mode!r} allowed={allowed_tools} disallowed={disallowed_tools}"
    )
    opts = ClaudeAgentOptions(
        model=LLM_MODEL,
        system_prompt=system_prompt,
        env={
            "ANTHROPIC_API_KEY": LLM_API_KEY,
            "ANTHROPIC_BASE_URL": LLM_BASE_URL,
            "API_TIMEOUT_MS": "3000000",
            "CLAUDE_CODE_RETRY_WATCHDOG": "1",
            "CLAUDE_CODE_MAX_RETRIES": "10"
        },
        cwd=workspace,
        resume=session_id if resume else None,
        session_id=session_id if not resume else None,
        include_partial_messages=True,
        setting_sources=setting_sources,
        skills=skills,
        permission_mode=cast(PermissionMode, sdk_mode),
        allowed_tools=allowed_tools or [],
        disallowed_tools=disallowed_tools or [],
    )
    return opts


# ============== SSE Helper ==============

def format_sse(event: str, data: dict, event_id: int | None = None) -> str:
    # ponytail: emit `id:` only when explicitly set. Heartbeats must NOT carry an
    # id — per HTML5 SSE spec, lastEventId only updates on `id:` lines, so a
    # heartbeat that bumped the id would corrupt the replay cursor on quiet streams.
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {event}\ndata: {json.dumps(data)}\n\n"


# ============== Models ==============

class WorkspaceSelectRequest(BaseModel):
    thread_id: str | None = None
    workspace: str


class WorkspaceResponse(BaseModel):
    thread_id: str
    workspace: str


class SessionResponse(BaseModel):
    thread_id: str
    first_message: str
    created_at: str | None = None
    # ponytail: ms-since-epoch from SDK; used by FE sidebar for time buckets + sort.
    last_modified: int | None = None


class SessionsListResponse(BaseModel):
    sessions: list[SessionResponse]


class MessagesResponse(BaseModel):
    session_id: str
    messages: list[dict]
    next_cursor: int | None = None


class AuthVerifyRequest(BaseModel):
    password: str


# ============== Routes ==============

@app.post("/api/auth/verify")
async def verify_auth(req: AuthVerifyRequest):
    return {"valid": req.password == "MS@1011"}


@app.get("/")
async def root():
    if _FE_INDEX_PATH.exists():
        return HTMLResponse(content=_FE_INDEX_PATH.read_text(encoding="utf-8"), status_code=200)
    return HTMLResponse(content=_CACHED_HTML, status_code=200)


@app.get("/maximalist-ui")
async def maximalist_ui():
    return HTMLResponse(content=_MAXIMALISM_HTML, status_code=200)


@app.get("/retro-ui")
async def retro_ui():
    return HTMLResponse(content=_RETRO_HTML, status_code=200)


@app.get("/industrial-ui")
async def industrial_ui():
    return HTMLResponse(content=_INDUSTRIAL_HTML, status_code=200)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/debug/usage")
async def debug_usage():
    """Quick test to see what usage fields the SDK returns."""
    from claude_agent_sdk import query, ClaudeAgentOptions

    result_usage = None
    result_model_usage = None
    result_cost = None

    async for msg in query(
        prompt="Say exactly: hi",
        options=ClaudeAgentOptions(include_partial_messages=True),
    ):
        from claude_agent_sdk import ResultMessage
        if isinstance(msg, ResultMessage):
            result_usage = msg.usage
            result_model_usage = msg.model_usage
            result_cost = msg.total_cost_usd
            break

    return {
        "usage": result_usage,
        "model_usage": result_model_usage,
        "total_cost_usd": result_cost,
    }


@app.get("/api/sessions", response_model=SessionsListResponse)
async def list_sessions(project_id: int | None = None):
    """List sessions using SDK — no DB needed."""
    ws = _resolve_workspace(project_id)

    raw = sdk_list_sessions(directory=ws, limit=0)
    sessions = [
        SessionResponse(
            thread_id=s.session_id,
            first_message=s.summary or s.first_prompt or s.session_id,
            created_at=str(s.created_at) if s.created_at else None,
            last_modified=s.last_modified,
        )
        for s in raw
    ]
    return SessionsListResponse(sessions=sessions)


@app.get("/api/sessions/{session_id}/messages", response_model=MessagesResponse)
async def get_session_messages(
    session_id: str,
    project_id: int | None = None,
    cursor: int | None = None,
    limit: int | None = None,
):
    """Read conversation history from SDK JSONL file with cursor-based pagination.

    - cursor: byte offset to resume from (from previous response's next_cursor)
    - limit: number of logical messages per page (default: unlimited)
    """
    # Validate — SDK session_id must be UUID; if invalid, return empty history
    try:
        uuid.UUID(session_id)
    except ValueError:
        return MessagesResponse(session_id=session_id, messages=[])

    ws = _resolve_workspace(project_id)
    messages, next_cursor = _read_sdk_history(
        ws, session_id, start_offset=cursor or 0, limit=limit
    )

    return MessagesResponse(
        session_id=session_id,
        messages=messages,
        next_cursor=next_cursor,
    )


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete session data.

    Note: SDK JSONL deletion is not supported. This endpoint is a no-op for SDK data.
    """
    return {"status": "deleted", "session_id": session_id}


@app.delete("/api/sessions")
async def delete_all_sessions():
    """Delete all session data.

    Note: SDK JSONL deletion is not supported. This endpoint is a no-op for SDK data.
    """
    return {"status": "deleted_all"}


# ============== Projects ==============

from schemas import Project, ProjectCreate, ProjectsListResponse, ProjectSessionsResponse


@app.get("/api/projects", response_model=ProjectsListResponse)
async def list_projects():
    """List all tracked projects."""
    with _get_db() as db:
        rows = db.execute("SELECT id, name, path, created_at FROM projects ORDER BY created_at DESC").fetchall()
    projects = [
        Project(id=r["id"], name=r["name"], path=r["path"], created_at=r["created_at"])
        for r in rows
    ]
    return ProjectsListResponse(projects=projects)


@app.post("/api/projects", response_model=Project)
async def add_project(request: ProjectCreate):
    """Add a project by path. Auto-discovers existing sessions."""
    path = Path(request.path).expanduser().resolve()
    if not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Path does not exist or is not a directory: {path}")

    with _get_db() as db:
        existing = db.execute("SELECT id FROM projects WHERE path = ?", (str(path),)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Project with this path already exists")

        cursor = db.execute(
            "INSERT INTO projects (name, path) VALUES (?, ?)",
            (request.name, str(path))
        )
        db.commit()
        project_id = cursor.lastrowid
        row = db.execute("SELECT id, name, path, created_at FROM projects WHERE id = ?", (project_id,)).fetchone()

    return Project(id=row["id"], name=row["name"], path=row["path"], created_at=row["created_at"])


@app.get("/api/projects/{project_id}/sessions", response_model=ProjectSessionsResponse)
async def get_project_sessions(project_id: int, limit: int = 5, offset: int = 0):
    """Get sessions for a project by reading SDK JSONL sessions list."""
    with _get_db() as db:
        row = db.execute("SELECT path FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")

    project_path = row["path"]
    # ponytail: ask for one extra to detect "has more" without a second round-trip.
    # SDK doesn't expose a total count, so over-fetching by 1 is the cheapest signal.
    raw = sdk_list_sessions(directory=project_path, limit=limit + 1, offset=offset)
    has_more = len(raw) > limit
    page = raw[:limit]
    sessions = [
        SessionResponse(
            thread_id=s.session_id,
            first_message=s.summary or s.first_prompt or s.session_id,
            created_at=str(s.created_at) if s.created_at else None,
            last_modified=s.last_modified,
        )
        for s in page
    ]
    return ProjectSessionsResponse(sessions=sessions, has_more=has_more)


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: int):
    """Remove a project from tracking. Does not delete files or sessions."""
    with _get_db() as db:
        row = db.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db.commit()
    return {"status": "deleted", "project_id": project_id}


@app.post("/api/workspaces/select", response_model=WorkspaceResponse)
async def select_workspace(request: WorkspaceSelectRequest):
    ws = Path(request.workspace).expanduser().resolve()
    if not ws.is_dir():
        raise HTTPException(status_code=400, detail=f"Workspace path is not a directory: {ws}")

    # Generate a new session_id for this workspace conversation
    thread_id = str(uuid.uuid4())
    return WorkspaceResponse(thread_id=thread_id, workspace=str(ws))


@app.get("/api/workspaces/current")
async def get_current_workspace(session_id: str | None = None):
    if session_id:
        # Try to find which workspace this session belongs to via SDK
        sessions = sdk_list_sessions(limit=0)
        for s in sessions:
            if s.session_id == session_id:
                return {"workspace": s.cwd or _DEFAULT_WORKSPACE}
    return {"workspace": _DEFAULT_WORKSPACE}


# ============== TTS audio endpoint ==============

@app.get("/api/tts")
async def tts_endpoint(q: str):
    """High-performance Piper Neural TTS with in-memory LRU caching and thread pool offloading."""
    clean_q = (q or "").strip()
    if not clean_q:
        raise HTTPException(status_code=400, detail="Text required")

    cache_key = hashlib.sha256(clean_q.encode("utf-8")).hexdigest()

    # 1. In-Memory LRU Cache lookup (0ms response)
    async with _tts_cache_lock:
        if cache_key in _tts_cache:
            _tts_cache.move_to_end(cache_key)
            return Response(
                content=_tts_cache[cache_key],
                media_type="audio/wav",
                headers={
                    "Cache-Control": "public, max-age=86400, immutable",
                    "X-Cache": "HIT",
                },
            )

    # 2. Synthesize with Piper Neural TTS via ThreadPool
    if _piper_voice is not None:
        loop = asyncio.get_running_loop()
        try:
            wav_bytes = await loop.run_in_executor(_tts_executor, _synthesize_piper_wav, clean_q)
            async with _tts_cache_lock:
                _tts_cache[cache_key] = wav_bytes
                if len(_tts_cache) > _TTS_CACHE_MAX_SIZE:
                    _tts_cache.popitem(last=False)
            return Response(
                content=wav_bytes,
                media_type="audio/wav",
                headers={
                    "Cache-Control": "public, max-age=86400, immutable",
                    "X-Cache": "MISS",
                },
            )
        except Exception as e:
            print(f"[ERROR] Piper synthesis failed for '{clean_q[:60]}...': {e}")

    # Fallback to web TTS if Piper is not available or encounters an error
    import urllib.parse
    import urllib.request
    try:
        def fetch_fallback():
            encoded = urllib.parse.quote(clean_q[:100])
            url = f"https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q={encoded}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                return resp.read()
        fallback_bytes = await asyncio.to_thread(fetch_fallback)
        return Response(content=fallback_bytes, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {e}")


# ============== Permission endpoints ==============

class PermissionDecisionRequest(BaseModel):
    request_id: str
    decision: Literal["allow", "deny"]
    session_id: str | None = None
    updated_input: dict | None = None
    answers: dict | None = None
    message: str | None = None


@app.post("/api/permissions/decision")
async def permission_decision(req: PermissionDecisionRequest):
    """Resolve a pending permission request (from can_use_tool callback)."""
    # ponytail: key is (session_id, request_id). If session_id omitted (old FE), scan for a match.
    key = None
    if req.session_id:
        key = (req.session_id, req.request_id)
        future = _permission_futures.pop(key, None)
    else:
        future = None
        for k, fut in list(_permission_futures.items()):
            if k[1] == req.request_id and not fut.done():
                future = _permission_futures.pop(k)
                key = k
                break
    if future is None:
        raise HTTPException(status_code=404, detail="Permission request not found or already resolved")
    if future.done():
        return {"status": "already_resolved"}
    future.set_result({
        "decision": req.decision,
        "updated_input": req.updated_input,
        "answers": req.answers,
        "message": req.message,
    })
    return {"status": "ok"}


@app.get("/api/permissions/pending")
async def permission_pending(thread_id: str | None = None):
    """List pending permission requests for a given thread (session_id).
    If thread_id is None, returns all pending requests (for backwards compatibility).
    """
    requests = []
    for key, meta in _permission_meta.items():
        if key not in _permission_futures or _permission_futures[key].done():
            continue
        sid, rid = key
        item = {**meta, "request_id": rid, "session_id": sid}
        requests.append(item)
    if thread_id is not None:
        requests = [r for r in requests if r.get("session_id") == thread_id]
    return {"requests": requests}


# ============== Streaming-Input Mode Endpoints (Phase 1+2) ==============

@app.post("/api/sessions/{session_id}/messages")
async def post_session_message(
    session_id: str,
    body: _UserMessage,
    workspace: str = Query(...),
):
    # ponytail: trust boundary — validate UUID here, surfaces immediately in logs.
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="session_id must be a UUID")
    print(f"[FE_OPTS] {session_id} setting_sources={body.setting_sources} skills={body.skills} permission_mode={body.permission_mode}")
    loop = await get_or_create_loop(workspace, session_id)
    await loop.enqueue(body)
    return {"status": "queued", "session_id": session_id}


@app.get("/api/sessions/{session_id}/events")
async def session_events(
    session_id: str,
    workspace: str = Query(...),
    setting_sources: str | None = Query(None),
    request: Request = None,
):
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="session_id must be a UUID")
    # ponytail: FE passes its current setting_sources (same value as localStorage
    # and the first message body) so the broadcast client is built with the
    # same scope the per-turn client will be built with. Invalid input falls
    # back to None (SDK defaults) rather than 400-ing — EventSource can't
    # recover from HTTP errors.
    parsed_setting_sources = _parse_setting_sources_query(setting_sources)
    loop = await get_or_create_loop(workspace, session_id)
    # ponytail: Last-Event-ID is the SSE-spec replay cursor. EventSource sets it
    # automatically on reconnect when the prior stream emitted `id:` lines.
    # Malformed (non-digit) is treated as 0 = full replay, which is safe.
    last_event_id = request.headers.get("Last-Event-ID") if request is not None else None
    last_id_int = int(last_event_id) if last_event_id and last_event_id.isdigit() else 0
    # ponytail: subscribe FIRST, then snapshot the buffer's high-water mark.
    # Anything broadcast after this snapshot arrives in sub_q only (the replay
    # scan is bounded by id <= buffer_high, the live tail is id > buffer_high).
    # No overlap, no gap, no lock needed in single-threaded asyncio.
    sub_q = loop.subscribe()
    # ponytail: slash palette is a page-load expectation. Broadcast the SDK's
    # command list as soon as the SSE connects, so typing `/` in a fresh
    # session (no first turn yet) still shows the popover. MUST run AFTER
    # subscribe — fresh connections don't replay, so a pre-subscribe
    # broadcast lands in the buffer but the new sub_q never sees it.
    # Idempotent: ensure_commands_broadcast caches the list, so replays and
    # reconnects are O(1).
    await loop.ensure_commands_broadcast(setting_sources=parsed_setting_sources)
    buffer_high = loop._event_seq
    print(session_id, workspace)
    async def stream():
        try:
            # ponytail: replay is for reconnect, not fresh connect. The browser's
            # EventSource auto-sets Last-Event-ID on auto-reconnect (network blip,
            # temporary drop) — that's the case replay exists for. A fresh page
            # load (or a new tab opening the events endpoint directly) sends no
            # Last-Event-ID, and replaying the whole buffer would just duplicate
            # the conversation the FE already loaded from /messages. Skip the
            # replay loop when there's no cursor.
            if last_id_int > 0:
                for eid, ev in list(loop._event_buffer):
                    if last_id_int < eid <= buffer_high:
                        print(f"[REPLAY] {session_id} sending {eid}", flush=True)
                        yield format_sse("message", ev, event_id=eid)
            # Live tail: anything broadcast after the buffer_high snapshot.
            while True:
                try:
                    eid, event = await asyncio.wait_for(sub_q.get(), timeout=15)
                    yield format_sse("message", event, event_id=eid)
                except asyncio.TimeoutError:
                    # ponytail: keepalive so proxies don't reap the connection.
                    # No event_id — preserves lastEventId across the keepalive.
                    yield format_sse("heartbeat", {"ts": asyncio.get_event_loop().time()})
        finally:
            loop.unsubscribe(sub_q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/sessions/{session_id}/interrupt")
async def session_interrupt(session_id: str, workspace: str = Query(...)):
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="session_id must be a UUID")
    loop = _SESSION_REGISTRY.get(session_id)
    if loop is not None and loop.workspace == workspace:
        await loop.interrupt()
    return {"status": "interrupted", "session_id": session_id}



# ============== Main ==============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
