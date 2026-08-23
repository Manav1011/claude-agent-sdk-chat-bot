"""FastAPI server for QA Automation Chatbot — Claude Agent SDK only."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
from typing import Literal

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
from claude_agent_sdk import ResultMessage, StreamEvent, list_sessions as sdk_list_sessions
from claude_agent_sdk.types import SettingSource

from schemas import Project, ProjectCreate, ProjectsListResponse, ProjectSessionsResponse, SessionResponse

HOST = "0.0.0.0"
PORT = 8225

LLM_API_KEY = os.environ.get("LLM_API_KEY", "97f5482590888eaa0afe9e173babd87c9abae1f5")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8000")

# Cache HTML frontends at module load time
_HTML_PATH = Path(__file__).parent / "index.html"
_CACHED_HTML = _HTML_PATH.read_text() if _HTML_PATH.exists() else "<h1>index.html not found</h1>"
_MAXIMALISM_HTML_PATH = Path(__file__).parent / "maximalism" / "index.html"
_MAXIMALISM_HTML = _MAXIMALISM_HTML_PATH.read_text() if _MAXIMALISM_HTML_PATH.exists() else "<h1>maximalism/index.html not found</h1>"
_RETRO_HTML_PATH = Path(__file__).parent / "retro" / "index.html"
_RETRO_HTML = _RETRO_HTML_PATH.read_text() if _RETRO_HTML_PATH.exists() else "<h1>retro/index.html not found</h1>"
_INDUSTRIAL_HTML_PATH = Path(__file__).parent / "industrial" / "index.html"
_INDUSTRIAL_HTML = _INDUSTRIAL_HTML_PATH.read_text() if _INDUSTRIAL_HTML_PATH.exists() else "<h1>industrial/index.html not found</h1>"

_DEFAULT_WORKSPACE = "."

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


# ============== Lifespan ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    yield
    global _WORKSPACE_CLIENTS
    _WORKSPACE_CLIENTS.clear()


app = FastAPI(title="QA Automation Chatbot", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Per-workspace SDK client cache (for context_usage queries between requests)
_WORKSPACE_CLIENTS: dict[str, ClaudeSDKClient] = {}
_cache_lock = asyncio.Lock()


# ============== SDK Helpers ==============

def _sdk_project_key(workspace: str) -> str:
    """Compute SDK project-key from workspace path."""
    return "-" + os.path.realpath(workspace).lstrip("/").replace("/", "-")


def _read_sdk_history(
    workspace: str,
    session_id: str,
    start_offset: int = 0,
    limit: int | None = None,
) -> tuple[list[dict], int | None]:
    """Read conversation history from SDK JSONL file.

    Supports cursor-based pagination: start_offset is a byte position to seek to,
    and limit is the number of logical messages per page. Returns next_cursor
    (byte offset after the last line read) or None if EOF.

    Speech explanations (StructuredOutput) are attached to
    their corresponding AI messages via the speech_explanation field.
    """
    project_key = _sdk_project_key(workspace)
    jsonl_path = Path.home() / ".claude" / "projects" / project_key / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return [], None

    messages = []
    pending_tool_calls: dict[str, dict] = {}  # assistant_uuid -> {name, input}
    pending_speech_explanation: str | None = None

    msg_count = 0
    next_byte_offset: int | None = None

    with open(jsonl_path, "rb") as f:
        f.seek(start_offset)
        for line in f:
            line_text = line.decode("utf-8", errors="replace").strip()
            if not line_text:
                continue
            try:
                entry = json.loads(line_text)
            except Exception:
                continue

            entry_type = entry.get("type", "")

            if entry_type == "user":
                msg = entry.get("message", {})
                msg_content = msg.get("content", [])
                # Normalize string content to list format
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
                                        # Attach speech explanation to the last AI message
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
                                        msg_count += 1
                    else:
                        texts = [c.get("text", "") for c in msg_content if c.get("type") == "text"]
                        human_text = "".join(texts)
                        if human_text and not human_text.startswith("[structured-output-enforce]") and not human_text.startswith("Stop hook feedback:"):
                            messages.append({"type": "human", "content": human_text})
                            msg_count += 1

            elif entry_type == "assistant":
                msg = entry.get("message", {})
                msg_content = msg.get("content", [])
                if isinstance(msg_content, list):
                    texts = []
                    thinking_content = None
                    for block in msg_content:
                        if block.get("type") == "text":
                            texts.append(block.get("text", ""))
                        elif block.get("type") == "tool_use":
                            # Capture non-StructuredOutput tool calls
                            tool_name = block.get("name")
                            tool_input = block.get("input", {})
                            assistant_uuid = entry.get("uuid")
                            if assistant_uuid and tool_name:
                                pending_tool_calls[assistant_uuid] = {
                                    "name": tool_name,
                                    "input": tool_input,
                                }
                        elif block.get("type") == "thinking":
                            thinking_content = block.get("thinking", "")
                    if texts:
                        ai_msg = {"type": "ai", "content": "".join(texts)}
                        messages.append(ai_msg)
                        msg_count += 1
                    if thinking_content:
                        messages.append({"type": "thinking", "content": thinking_content})
                        msg_count += 1

            # Track byte offset of next line (current position after reading this line)
            next_byte_offset = f.tell()

            # Stop after limit complete logical messages
            if limit is not None and msg_count >= limit:
                break
    return messages, next_byte_offset




SPEECH_EXPLANATION_SYSTEM_PROMPT = """After your response, produce a StructuredOutput with a detailed spoken explanation — as if you're tutoring someone through the entire response, section by section.

Walk through the same topics your response covered, with the same depth. Do not distill or skip details. For each concept, explain the "why" behind it, use analogies to make it click, and give concrete examples. Imagine you're on a call with someone who read your response and wants you to walk them through it properly — that's this explanation.

Structure your explanation to mirror your response's flow:
- Start with the core concept or main idea, explained fully
- Walk through each section or sub-topic your response covered, in order
- For each section: explain the key ideas, not just what it is but what it means and why it matters
- Use everyday analogies wherever something abstract is introduced
- End with why this matters or how it connects to the bigger picture

Do NOT just restate your response in fewer words. Do NOT narrate what you did ("I covered...", "I explained..."). The explanation IS the full walkthrough — a student should finish listening and understand everything your response covered."""

SYSTEM_PROMPT_EXPLANATION_SCHEMA = {
    "type": "json_schema",
    "schema": {
        "type": "object",
        "properties": {
            "explanation": {
                "type": "string",
                "description": "A detailed verbal walkthrough of the entire response, section by section. Covers the same topics with the same depth as the response itself. Written as a tutor explaining to a student — conversational, uses analogies for abstract concepts, walks through every major point the response covered. NOT a summary or TLDR; the full explanation as if spoken aloud during a tutoring session."
            }
        },
        "required": ["explanation"],
    },
}

# Read-only tool set applied when permission_mode == "plan". These tools are the
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
    permission_mode: Literal["plan", "bypassPermissions"] | None = None,
) -> ClaudeAgentOptions:
    # "plan" (read-only) is enforced via a tool whitelist rather than the SDK's
    # plan semantics: run on default permission checks but only expose the
    # read-only tools so no write/executable tool can ever be called.
    read_only = permission_mode == "plan"
    opts = ClaudeAgentOptions(
        model="ornith-1.5",
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
    permission_mode: Literal["plan", "bypassPermissions"] | None = None
    """Permission mode. 'plan' = read-only, 'bypassPermissions' = full access, null = SDK defaults."""


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

            await client.query(prompt=request.message)

            async for msg in client.receive_response():
                # --- StreamEvent ---
                if isinstance(msg, StreamEvent):
                    evt = msg.event
                    evt_type = evt.get("type")

                    if evt_type == "content_block_delta":
                        delta = evt.get("delta", {})
                        d_type = delta.get("type")

                        if d_type == "text_delta":
                            yield format_sse("message", {
                                "type": "text_delta",
                                "content": delta.get("text", ""),
                            })

                        elif d_type == "thinking_delta":
                            yield format_sse("message", {
                                "type": "thinking_delta",
                                "content": delta.get("thinking", ""),
                            })

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
                        # Track when a tool_use content block finishes
                        pass

                    elif evt_type == "message_stop":
                        # Emit any pending tool calls as tool_result events
                        for idx, tool_data in pending_tools.items():
                            args_str = tool_data.get("args_str", "")
                            try:
                                args_json = json.loads(args_str) if args_str else {}
                            except json.JSONDecodeError:
                                args_json = {}
                            yield format_sse("message", {
                                "type": "tool_result",
                                "tool_name": tool_data["name"],
                                "tool_id": tool_data["id"],
                                "args": args_json,
                            })
                        pending_tools.clear()

                # --- ResultMessage ---
                elif isinstance(msg, ResultMessage):
                    # print(f"[USAGE] input={turn_usage['input_tokens']} output={turn_usage['output_tokens']} total={turn_usage['total_tokens']} model_usage={msg.model_usage} usage={msg.usage} cost=${msg.total_cost_usd}")
                    # Grab usage from ResultMessage — prefer model_usage (camelCase keys)
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

                    # In speech mode, extract structured explanation
                    if speech_mode and msg.structured_output:
                        explanation = msg.structured_output.get("explanation", "")
                        if explanation:
                            yield format_sse("message", {
                                "type": "speech_explanation",
                                "content": explanation,
                            })

                    # Get full context usage breakdown via SDK
                    try:
                        ctx = await client.get_context_usage()
                        if ctx:
                            yield format_sse("message", {
                                "type": "context_usage",
                                "data": ctx,
                            })
                    except Exception as e:
                        print(f"[WARN] get_context_usage failed: {e}")

                    yield format_sse("done", {
                        "thread_id": session_id,
                        "usage": turn_usage if turn_usage["total_tokens"] > 0 else None,
                    })
                    return

        except Exception as e:
            print(f"Error during streaming: {e}")
            yield format_sse("error", {"message": str(e)})

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
