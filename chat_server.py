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

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Literal

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
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

LLM_API_KEY = os.environ.get("LLM_API_KEY", "97f5482590888eaa0afe9e173babd87c9abae1f5")
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
# Maps request_id -> asyncio.Future that frontend resolves via POST /api/permissions/decision
_permission_futures: dict[str, asyncio.Future] = {}
_permission_meta: dict[str, dict] = {}

# ============== SQLite (projects DB) ==============
import sqlite3

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

# Per-workspace SDK client cache (for context_usage queries between requests)
_WORKSPACE_CLIENTS: dict[str, ClaudeSDKClient] = {}
_cache_lock = asyncio.Lock()


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
                        texts = [c.get("text", "") for c in msg_content if c.get("type") == "text"]
                        human_text = "".join(texts)
                        if human_text and not human_text.startswith("[structured-output-enforce]") and not human_text.startswith("Stop hook feedback:"):
                            messages.append({"type": "human", "content": human_text})
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

# Read-only tool set applied when permission_mode == "read_only". These tools are the
# only ones available to the agent (no write/executable tool can be called), and
# they run with no approval prompt (see allowed_tools below).
_READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebFetch", "WebSearch"]

def _build_options(
    workspace: str,
    session_id: str | None = None,
    resume: bool = False,
    system_prompt: str | None = None,
    setting_sources: list[SettingSource] | None = None,
    skills: list[str] | Literal["all"] | None = None,
    permission_mode: Literal["read_only", "bypassPermissions"] | None = None,
) -> ClaudeAgentOptions:
    # "read_only" (read-only) is enforced via a tool whitelist rather than the SDK's
    # read_only semantics: run on default permission checks but only expose the
    # read-only tools so no write/executable tool can ever be called.
    read_only = permission_mode == "read_only"
    opts = ClaudeAgentOptions(
        model="ornith-1.0",
        system_prompt=system_prompt,
        env={
            "ANTHROPIC_API_KEY": LLM_API_KEY,
            "ANTHROPIC_BASE_URL": LLM_BASE_URL,
        },
        cwd=workspace,
        resume=session_id if resume else None,
        session_id=session_id if not resume else None,
        include_partial_messages=True,
        setting_sources=setting_sources,
        skills=skills,
        permission_mode=None if read_only else permission_mode,
    )
    if read_only:
        opts.tools = list(_READ_ONLY_TOOLS)
        opts.allowed_tools = list(_READ_ONLY_TOOLS)
    return opts


# ============== SSE Helper ==============

def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ============== Models ==============

class ChatRequest(BaseModel):
    message: str
    thread_id: str | None = None
    project_id: int | None = None
    speech_explanation: bool = False
    """When true, agent generates a speech explanation for each response via StructuredOutput."""
    setting_sources: list[SettingSource] | None = None
    """Control which filesystem settings to load. null = SDK defaults (all sources)."""
    skills: list[str] | Literal["all"] | None = None
    """Skills to enable. null = SDK defaults, [] = no skills, 'all' = all discovered skills."""
    permission_mode: Literal["read_only", "bypassPermissions"] | None = None
    """Permission mode. 'read_only' = read-only (tool whitelist), 'bypassPermissions' = full access, null = SDK defaults."""
    image_paths: list[str] | None = None
    """Local paths to images to attach to this message. Model will read them via its Read tool."""


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


class SessionsListResponse(BaseModel):
    sessions: list[SessionResponse]


class MessagesResponse(BaseModel):
    session_id: str
    messages: list[dict]
    next_cursor: int | None = None


# ============== Routes ==============

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

    raw = sdk_list_sessions(directory=ws, limit=50)
    sessions = [
        SessionResponse(
            thread_id=s.session_id,
            first_message=s.summary or s.first_prompt or s.session_id,
            created_at=str(s.created_at) if s.created_at else None,
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
async def get_project_sessions(project_id: int):
    """Get sessions for a project by reading SDK JSONL sessions list."""
    with _get_db() as db:
        row = db.execute("SELECT path FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")

    project_path = row["path"]
    raw = sdk_list_sessions(directory=project_path, limit=50)
    sessions = [
        SessionResponse(
            thread_id=s.session_id,
            first_message=s.summary or s.first_prompt or s.session_id,
            created_at=str(s.created_at) if s.created_at else None,
        )
        for s in raw
    ]
    return ProjectSessionsResponse(sessions=sessions)


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
        sessions = sdk_list_sessions(limit=100)
        for s in sessions:
            if s.session_id == session_id:
                return {"workspace": s.cwd or _DEFAULT_WORKSPACE}
    return {"workspace": _DEFAULT_WORKSPACE}


# ============== Image upload endpoint ==============

@app.post("/api/upload")
async def upload_images(files: list[UploadFile]):
    """Save uploaded images to /tmp/uploads and return their paths."""
    upload_dir = Path("/tmp/uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)

    paths: list[str] = []
    for f in files:
        ext = Path(f.filename or "image.png").suffix or ".png"
        path = upload_dir / f"{uuid.uuid4().hex}{ext}"
        path.write_bytes(await f.read())
        paths.append(str(path))

    return {"paths": paths}
 
 
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
    updated_input: dict | None = None
    answers: dict | None = None
    message: str | None = None


@app.post("/api/permissions/decision")
async def permission_decision(req: PermissionDecisionRequest):
    """Resolve a pending permission request (from can_use_tool callback)."""
    future = _permission_futures.pop(req.request_id, None)
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
    requests = [
        {**meta, "request_id": rid}
        for rid, meta in _permission_meta.items()
        if rid in _permission_futures and not _permission_futures[rid].done()
    ]
    if thread_id is not None:
        requests = [r for r in requests if r.get("session_id") == thread_id]
    return {"requests": requests}


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Send a message and stream the response using Claude Agent SDK.

    thread_id IS the SDK session_id (UUID). History is read from SDK JSONL.
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    print(f"[CHAT_REQUEST] {request.model_dump_json(exclude={'message'})}")

    # Resolve workspace from project_id
    workspace = _resolve_workspace(request.project_id)
    workspace = str(Path(workspace).expanduser().resolve())

    # Resolve session_id — must be UUID for SDK; generate new if invalid
    raw = request.thread_id
    if raw:
        try:
            uuid.UUID(raw)
            session_id = raw
        except ValueError:
            session_id = str(uuid.uuid4())
    else:
        session_id = str(uuid.uuid4())

    # Check if this session already has a history file to decide create vs resume
    project_key = _sdk_project_key(workspace)
    jsonl_path = Path.home() / ".claude" / "projects" / project_key / f"{session_id}.jsonl"
    session_exists = jsonl_path.exists()

    async def event_stream():
        # Unified queue for all SSE events (both from receive_response worker and can_use_tool callback)
        sse_queue: asyncio.Queue[tuple[str, dict] | None] = asyncio.Queue()

        async def can_use_tool(
            tool_name: str,
            tool_input: dict,
            context: ToolPermissionContext,
        ) -> PermissionResultAllow | PermissionResultDeny:
            request_id = context.tool_use_id or f"perm_{uuid.uuid4().hex[:8]}"
            future: asyncio.Future = asyncio.Future()
            _permission_futures[request_id] = future
            meta = {
                "tool_name": tool_name,
                "tool_input": tool_input,
                "tool_use_id": context.tool_use_id,
                "title": context.title,
                "description": context.description,
                "suggestions": [s.to_dict() for s in (context.suggestions or [])],
                "session_id": session_id,
            }
            _permission_meta[request_id] = meta
            # Put SSE event directly into queue so the generator yields it immediately
            sse_queue.put_nowait(("message", {
                "type": "permission_request",
                "request_id": request_id,
                "session_id": session_id,
                **meta,
            }))
            try:
                result = await asyncio.wait_for(future, timeout=300)
            except asyncio.TimeoutError:
                result = {"decision": "deny", "message": "Permission request timed out"}
            finally:
                _permission_futures.pop(request_id, None)
                _permission_meta.pop(request_id, None)
            decision = result["decision"]
            if decision == "allow":
                # AskUserQuestion: answers IS the tool result — must be returned as updated_input
                answers = result.get("answers")
                if tool_name == "AskUserQuestion" and answers is not None:
                    # JS UI needs questions array + answers; pass both
                    return PermissionResultAllow(updated_input={
                        "questions": tool_input.get("questions", []),
                        "answers": answers,
                    })
                updated = result.get("updated_input")
                return PermissionResultAllow(updated_input=updated if updated is not None else tool_input)
            return PermissionResultDeny(message=result.get("message", "User denied"))

        speech_mode = request.speech_explanation
        opts = _build_options(
            workspace=workspace,
            session_id=session_id,
            resume=session_exists,
            system_prompt=SPEECH_EXPLANATION_SYSTEM_PROMPT if speech_mode else None,
            setting_sources=request.setting_sources,
            skills=request.skills,
            permission_mode=request.permission_mode,
        )

        # In speech mode, request structured output for the explanation
        if speech_mode:
            opts.output_format = SYSTEM_PROMPT_EXPLANATION_SCHEMA

        # Wire permission callback; SDK auto-sets permission_prompt_tool_name="stdio"
        # when can_use_tool is set, routing all permission requests through the callback
        opts.can_use_tool = can_use_tool

        # Remember JSONL file size before this turn so we can read only new entries
        # after the turn completes to get actual tool result content
        project_key = _sdk_project_key(workspace)
        jsonl_path = Path.home() / ".claude" / "projects" / project_key / f"{session_id}.jsonl"
        jsonl_size_before = jsonl_path.stat().st_size if jsonl_path.exists() else 0

        async def response_reader():
            pending_tools: dict[int, dict] = {}
            turn_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
            try:
                # Reuse cached client only when no custom config is passed — custom opts
                # (skills, setting_sources, permission_mode) must be fresh per request
                has_custom_config = any([
                    request.setting_sources is not None,
                    request.skills is not None,
                    request.permission_mode is not None,
                ])
                cache_key = f"{workspace}:{session_id}"
                async with _cache_lock:
                    if cache_key in _WORKSPACE_CLIENTS and not has_custom_config:
                        client = _WORKSPACE_CLIENTS[cache_key]
                    else:
                        client = ClaudeSDKClient(options=opts)
                        await client.connect()
                        if not has_custom_config:
                            _WORKSPACE_CLIENTS[cache_key] = client

                # Build prompt with image context if any were uploaded
                prompt = request.message
                if request.image_paths:
                    image_context = "\n".join(
                        f"- image_{i+1}: {p}" for i, p in enumerate(request.image_paths)
                    )
                    prompt = f"Attached images:\n{image_context}\n\n{request.message}"

                await client.query(prompt=prompt)

                async for msg in client.receive_response():
                    # --- StreamEvent ---
                    if isinstance(msg, StreamEvent):
                        evt = msg.event
                        evt_type = evt.get("type")

                        if evt_type == "content_block_delta":
                            delta = evt.get("delta", {})
                            d_type = delta.get("type")

                            if d_type == "text_delta":
                                sse_queue.put_nowait(("message", {
                                    "type": "text_delta",
                                    "content": delta.get("text", ""),
                                }))

                            elif d_type == "thinking_delta":
                                sse_queue.put_nowait(("message", {
                                    "type": "thinking_delta",
                                    "content": delta.get("thinking", ""),
                                }))

                            elif d_type == "input_json_delta":
                                idx = evt.get("index")
                                partial = delta.get("partial_json", "")
                                if idx in pending_tools:
                                    pending_tools[idx]["args_str"] += partial

                        elif evt_type == "content_block_start":
                            cb = evt.get("content_block", {})
                            if cb.get("type") == "tool_use":
                                idx: int | None = evt.get("index")
                                if idx is not None:
                                    pending_tools[idx] = {
                                        "name": cb.get("name"),
                                        "id": cb.get("id"),
                                        "args_str": "",
                                    }

                        elif evt_type == "message_delta":
                            usage = evt.get("usage", {})
                            if usage:
                                turn_usage["input_tokens"] += usage.get("prompt_tokens", 0)
                                turn_usage["output_tokens"] += usage.get("completion_tokens", 0)
                                turn_usage["total_tokens"] = (
                                    turn_usage["input_tokens"] + turn_usage["output_tokens"]
                                )

                        elif evt_type == "content_block_stop":
                            pass

                        elif evt_type == "message_stop":
                            for idx, tool_data in pending_tools.items():
                                args_str = tool_data.get("args_str", "")
                                try:
                                    args_json = json.loads(args_str) if args_str else {}
                                except json.JSONDecodeError:
                                    args_json = {}
                                sse_queue.put_nowait(("message", {
                                    "type": "tool_result",
                                    "tool_name": tool_data["name"],
                                    "tool_id": tool_data["id"],
                                    "args": args_json,
                                }))
                            pending_tools.clear()

                    # --- ResultMessage ---
                    elif isinstance(msg, ResultMessage):
                        if msg.model_usage and turn_usage["total_tokens"] == 0:
                            for model, u in msg.model_usage.items():
                                turn_usage["input_tokens"] += u.get("inputTokens", 0)
                                turn_usage["output_tokens"] += u.get("outputTokens", 0)
                            turn_usage["total_tokens"] = (
                                turn_usage["input_tokens"] + turn_usage["output_tokens"]
                            )
                        elif msg.usage and turn_usage["total_tokens"] == 0:
                            turn_usage["input_tokens"] = msg.usage.get("input_tokens", 0)
                            turn_usage["output_tokens"] = msg.usage.get("output_tokens", 0)
                            turn_usage["total_tokens"] = msg.usage.get("total_tokens", 0)

                        if speech_mode and msg.structured_output:
                            explanation = msg.structured_output.get("explanation", "")
                            if explanation:
                                sse_queue.put_nowait(("message", {
                                    "type": "speech_explanation",
                                    "content": explanation,
                                }))

                        try:
                            ctx = await client.get_context_usage()
                            if ctx:
                                sse_queue.put_nowait(("message", {
                                    "type": "context_usage",
                                    "data": ctx,
                                }))
                        except Exception as e:
                            print(f"[WARN] get_context_usage failed: {e}")

                        if jsonl_path.exists():
                            with open(jsonl_path, "rb") as f:
                                f.seek(jsonl_size_before)
                                new_bytes = f.read()
                            if new_bytes.strip():
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
                                                if isinstance(item, dict):
                                                    if item.get("type") == "text":
                                                        text_parts.append(item.get("text", ""))
                                        content = "".join(text_parts) if text_parts else str(tool_result)
                                        source_uuid = entry.get("sourceToolAssistantUUID", "")
                                        if source_uuid in pending_tools and pending_tools[source_uuid].get("name") == "StructuredOutput":
                                            continue
                                        if content:
                                            sse_queue.put_nowait(("message", {
                                                "type": "tool_result_content",
                                                "tool_id": source_uuid,
                                                "content": content,
                                            }))
                                    pending_tools.clear()

                        sse_queue.put_nowait(("done", {
                            "thread_id": session_id,
                            "usage": turn_usage if turn_usage["total_tokens"] > 0 else None,
                        }))

            except Exception as err:
                print(f"Error during response_reader: {err}")
                sse_queue.put_nowait(("error", {"message": str(err)}))
            finally:
                sse_queue.put_nowait(None)

        reader_task = asyncio.create_task(response_reader())
        try:
            while True:
                item = await sse_queue.get()
                if item is None:
                    break
                event_name, event_data = item
                yield format_sse(event_name, event_data)
        finally:
            # Resolve dangling permissions FIRST so wait_for in response_reader exits.
            # Only AFTER resolving should we cancel the reader task.
            for rid, meta in list(_permission_meta.items()):
                if meta.get("session_id") == session_id and _permission_futures.get(rid) and not _permission_futures[rid].done():
                    _permission_futures[rid].set_result({"decision": "deny", "message": "Session ended"})
                    _permission_futures.pop(rid, None)
                    _permission_meta.pop(rid, None)
            if not reader_task.done():
                reader_task.cancel()
            # Clean up uploaded image files
            if request.image_paths:
                for path in request.image_paths:
                    Path(path).unlink(missing_ok=True)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )




# ============== Main ==============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
