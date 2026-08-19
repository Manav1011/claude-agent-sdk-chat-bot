"""
FastAPI server for QA Automation Chatbot.

Provides a REST API + SSE streaming for chat interactions with the QA automation agent.
Serves the index.html frontend directly at /.
"""

import json
import os
import uuid
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import BaseModel

import aiosqlite
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

# Agent imports - assumes deepagents and langchain packages are installed
try:
    from langchain_anthropic import ChatAnthropic
    from deepagents import create_deep_agent
    from deepagents.backends import FilesystemBackend, CompositeBackend, StateBackend
    from deepagents.backends.utils import create_file_data
    from langchain_mcp_adapters.client import MultiServerMCPClient
    AGENT_AVAILABLE = True
except ImportError as e:
    AGENT_AVAILABLE = False
    AGENT_ERROR = str(e)

# Constants
HOST = "0.0.0.0"
PORT = 8000
# Skills path — will be resolved relative to workspace at runtime


def _resolve_skills(workspace: str) -> list[str]:
    """Resolve skills paths within the workspace.

    Checks for skills in <workspace>/skills/ (if it exists).
    Returns relative paths (e.g. "/skills") because FilesystemBackend
    with virtual_mode=True treats paths as virtual paths under the cwd.
    """
    workspace_path = Path(workspace).resolve()
    
    # Check for skills in the workspace
    ws_skills = workspace_path / "skills"
    if ws_skills.is_dir():
        return ["/skills"]
    
    return []


DB_PATH = Path(__file__).parent / "chat_memory.db"
LLM_API_KEY = os.environ.get("LLM_API_KEY", "97f5482590888eaa0afe9e173babd87c9abae1f5")

# Cache HTML frontends at module load time
_HTML_PATH = Path(__file__).parent / "index.html"
_CACHED_HTML = _HTML_PATH.read_text() if _HTML_PATH.exists() else "<h1>index.html not found</h1>"
_MAXIMALISM_HTML_PATH = Path(__file__).parent / "maximalism" / "index.html"
_MAXIMALISM_HTML = _MAXIMALISM_HTML_PATH.read_text() if _MAXIMALISM_HTML_PATH.exists() else "<h1>maximalism/index.html not found</h1>"
_RETRO_HTML_PATH = Path(__file__).parent / "retro" / "index.html"
_RETRO_HTML = _RETRO_HTML_PATH.read_text() if _RETRO_HTML_PATH.exists() else "<h1>retro/index.html not found</h1>"
_INDUSTRIAL_HTML_PATH = Path(__file__).parent / "industrial" / "index.html"
_INDUSTRIAL_HTML = _INDUSTRIAL_HTML_PATH.read_text() if _INDUSTRIAL_HTML_PATH.exists() else "<h1>industrial/index.html not found</h1>"

# App
# ============== Lifespan ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize on startup, clean up on shutdown."""
    yield
    # Shutdown: clear agent cache and close DB
    global _db_conn, _WORKSPACE_AGENTS
    _WORKSPACE_AGENTS.clear()
    if _db_conn:
        try:
            await _db_conn.close()
            print("Database connection closed gracefully.")
        except Exception as e:
            print(f"Error closing DB: {e}")
        _db_conn = None


app = FastAPI(title="QA Automation Chatbot", lifespan=lifespan)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global agent cache (keyed by workspace path) & db instances
_WORKSPACE_AGENTS: dict[str, Any] = {}   # workspace_path -> compiled agent
_MCP_CLIENT = None                       # shared across all workspaces
_TOOLS = None                            # shared MCP tools
_DEFAULT_WORKSPACE = "."                 # fallback when no workspace specified
_db_conn = None
_checkpointer = None


async def get_db():
    """Get persistent SQLite connection."""
    global _db_conn, _checkpointer
    if _db_conn is None:
        _db_conn = await aiosqlite.connect(str(DB_PATH))
        _checkpointer = AsyncSqliteSaver(_db_conn)
        # Create session_meta cache table if it doesn't exist, or migrate it
        await _db_conn.execute("""
            CREATE TABLE IF NOT EXISTS session_meta (
                thread_id TEXT PRIMARY KEY,
                first_message TEXT NOT NULL,
                workspace TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # Migrate: add workspace column if it doesn't exist (for existing DBs)
        try:
            await _db_conn.execute("ALTER TABLE session_meta ADD COLUMN workspace TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass  # Column already exists
        await _db_conn.commit()
    return _db_conn, _checkpointer


async def get_or_create_agent(workspace: str):
    """Get or create a deep agent for the given workspace path.

    Agents are cached by workspace path. The MCP client and tools are shared
    across all workspaces. Each workspace gets its own FilesystemBackend with
    virtual_mode=True (agent cannot escape the workspace directory).
    """
    global _MCP_CLIENT, _TOOLS

    if not AGENT_AVAILABLE:
        raise RuntimeError(f"Agent packages not available: {AGENT_ERROR}")

    # Return cached agent if it exists for this workspace
    if workspace in _WORKSPACE_AGENTS:
        return _WORKSPACE_AGENTS[workspace]

    _, checkpointer = await get_db()

    # Shared MCP client + tools (lazy-init on first workspace creation)

    # LLM setup
    model = ChatAnthropic(
        model="ornith-1.0",
        default_headers={"Authorization": f"Bearer {LLM_API_KEY}"},
        base_url="http://localhost:8083/anthropic"
    )

    # Backend scoped to workspace — virtual_mode=True prevents escape
    
    backend = FilesystemBackend(
        root_dir="/home/web-h-063",
        virtual_mode=False
    )

    # Resolve skills for this workspace
    
    # Create agent
    agent = create_deep_agent(
    model=model,
    system_prompt=f"""

## Workspace Constraint (STRICT)
Your workspace is: `{workspace}`

""",
        checkpointer=checkpointer,
        backend=backend
    )

    _WORKSPACE_AGENTS[workspace] = agent
    return agent


# ============== Models ==============

class ChatRequest(BaseModel):
    message: str
    thread_id: str | None = None
    workspace: str | None = None


class WorkspaceSelectRequest(BaseModel):
    thread_id: str | None = None
    workspace: str


class WorkspaceResponse(BaseModel):
    thread_id: str
    workspace: str


class SessionResponse(BaseModel):
    thread_id: str
    first_message: str
    workspace: str
    created_at: str | None = None
    updated_at: str | None = None


class SessionsListResponse(BaseModel):
    sessions: list[SessionResponse]


class MessagesResponse(BaseModel):
    thread_id: str
    messages: list[dict]


# ============== Message Parsing ==============

def parse_agent_messages(result: dict) -> list[dict]:
    """
    Parse the agent result into a list of message dicts.

    Args:
        result: The result from agent.ainvoke()

    Returns:
        List of message dicts with type, content, etc.
    """
    messages = []

    for msg in result.get("messages", []):
        msg_type = msg.type if hasattr(msg, 'type') else type(msg).__name__.lower()

        msg_dict = {
            "type": msg_type,
            "content": None,
            "id": msg.id if hasattr(msg, 'id') else None,
        }

        # Handle different message types
        if hasattr(msg, 'content'):
            content = msg.content
            if isinstance(content, list):
                # Parse content blocks
                blocks = []
                tool_calls = []
                thinking = None
                text = None

                for block in content:
                    if isinstance(block, dict):
                        block_type = block.get("type", "")
                        if block_type == "thinking":
                            thinking = block.get("thinking", "")
                        elif block_type == "text":
                            text = block.get("text", "")
                        elif block_type in ("tool_use", "tool_result"):
                            tool_calls.append(block)
                        blocks.append(block)
                    else:
                        blocks.append(str(block))

                msg_dict["content"] = text
                msg_dict["thinking"] = thinking
                msg_dict["blocks"] = blocks
                msg_dict["tool_calls"] = tool_calls
            else:
                msg_dict["content"] = str(content)

        # Tool calls from tool_calls attribute
        if hasattr(msg, 'tool_calls') and msg.tool_calls:
            msg_dict["tool_calls"] = [
                {"name": tc.get("name"), "args": tc.get("args") or tc.get("input")}
                for tc in msg.tool_calls
            ]

        # Token Usage Metadata
        usage = None
        if hasattr(msg, 'usage_metadata') and msg.usage_metadata:
            usage = dict(msg.usage_metadata)
        elif hasattr(msg, 'response_metadata') and isinstance(msg.response_metadata, dict):
            token_usage = msg.response_metadata.get("usage") or msg.response_metadata.get("token_usage")
            if token_usage:
                usage = dict(token_usage)

        if usage:
            msg_dict["usage"] = {
                "input_tokens": usage.get("input_tokens") or usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("output_tokens") or usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0) or ((usage.get("input_tokens", 0) or usage.get("prompt_tokens", 0)) + (usage.get("output_tokens", 0) or usage.get("completion_tokens", 0)))
            }

        messages.append(msg_dict)

    return messages


def format_sse(event: str, data: dict) -> str:
    """Format data as SSE event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ============== Routes ==============

@app.get("/")
async def root():
    """Serve the cached HTML frontend."""
    return HTMLResponse(content=_CACHED_HTML, status_code=200)


@app.get("/maximalist-ui")
async def maximalist_ui():
    """Serve the De Stijl (maximalism) themed frontend."""
    return HTMLResponse(content=_MAXIMALISM_HTML, status_code=200)


@app.get("/retro-ui")
async def retro_ui():
    """Serve the 8-bit retro terminal themed frontend."""
    return HTMLResponse(content=_RETRO_HTML, status_code=200)


@app.get("/industrial-ui")
async def industrial_ui():
    """Serve the Industrial Workbench themed frontend."""
    return HTMLResponse(content=_INDUSTRIAL_HTML, status_code=200)


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "agent_available": AGENT_AVAILABLE,
    }


@app.get("/api/sessions", response_model=SessionsListResponse)
async def list_sessions():
    """List all chat sessions using cached session_meta table (no N+1 state deserialization)."""
    conn, _ = await get_db()
    sessions = []
    try:
        async with conn.cursor() as cursor:
            # Join checkpoints with session_meta for O(1) first_message lookup
            await cursor.execute("""
                SELECT c.thread_id, m.first_message, m.workspace, m.created_at
                FROM (
                    SELECT thread_id, MAX(checkpoint_id) as latest_cp
                    FROM checkpoints
                    GROUP BY thread_id
                    ORDER BY latest_cp DESC
                ) c
                LEFT JOIN session_meta m ON c.thread_id = m.thread_id
            """)
            rows = await cursor.fetchall()

            for row in rows:
                thread_id = row[0]
                first_msg = row[1] or thread_id
                workspace = row[2] or _DEFAULT_WORKSPACE
                created_at = row[3]
                sessions.append(SessionResponse(
                    thread_id=thread_id,
                    first_message=first_msg,
                    workspace=workspace,
                    created_at=created_at,
                ))
    except Exception as e:
        print(f"Error reading sessions from DB: {e}")

    return SessionsListResponse(sessions=sessions)


@app.get("/api/sessions/{thread_id}/messages", response_model=MessagesResponse)
async def get_session_messages(thread_id: str):
    """Get all historical messages for a session directly from SQLite state."""
    # Resolve workspace for this session
    conn, _ = await get_db()
    async with conn.cursor() as cursor:
        await cursor.execute("SELECT workspace FROM session_meta WHERE thread_id = ?", (thread_id,))
        row = await cursor.fetchone()
        workspace = row[0] if row and row[0] else _DEFAULT_WORKSPACE

    agent = await get_or_create_agent(workspace)
    config = {"configurable": {"thread_id": thread_id}}
    
    try:
        state = await agent.aget_state(config)
        if not state or not state.values:
            return MessagesResponse(thread_id=thread_id, messages=[])
        
        parsed = parse_agent_messages(state.values)
        return MessagesResponse(thread_id=thread_id, messages=parsed)
    except Exception as e:
        print(f"Error fetching state for thread {thread_id}: {e}")
        return MessagesResponse(thread_id=thread_id, messages=[])


@app.delete("/api/sessions/{thread_id}")
async def delete_session(thread_id: str):
    """Delete a single session thread from chat_memory.db SQLite database."""
    conn, _ = await get_db()
    try:
        async with conn.cursor() as cursor:
            await cursor.execute("DELETE FROM checkpoints WHERE thread_id = ?", (thread_id,))
            await cursor.execute("DELETE FROM writes WHERE thread_id = ?", (thread_id,))
            await cursor.execute("DELETE FROM session_meta WHERE thread_id = ?", (thread_id,))
        await conn.commit()
    except Exception as e:
        print(f"Error deleting thread {thread_id}: {e}")
    return {"status": "deleted", "thread_id": thread_id}


@app.delete("/api/sessions")
async def delete_all_sessions():
    """Bulk delete all sessions in a single transaction."""
    conn, _ = await get_db()
    try:
        async with conn.cursor() as cursor:
            await cursor.execute("DELETE FROM checkpoints")
            await cursor.execute("DELETE FROM writes")
            await cursor.execute("DELETE FROM session_meta")
        await conn.commit()
    except Exception as e:
        print(f"Error deleting all sessions: {e}")
    return {"status": "deleted_all"}


@app.post("/api/workspaces/select", response_model=WorkspaceResponse)
async def select_workspace(request: WorkspaceSelectRequest):
    """Set workspace for a session. Creates/retrieves the agent for that workspace."""
    ws = Path(request.workspace).expanduser().resolve()
    if not ws.is_dir():
        raise HTTPException(status_code=400, detail=f"Workspace path is not a directory: {ws}")

    thread_id = request.thread_id or f"session-{uuid.uuid4().hex[:8]}"

    conn, _ = await get_db()
    await conn.execute(
        "INSERT OR REPLACE INTO session_meta (thread_id, first_message, workspace) VALUES (?, ?, ?)",
        (thread_id, "", str(ws))
    )
    await conn.commit()

    # Lazy-create agent for this workspace
    print(ws)
    await get_or_create_agent(str(ws))

    return WorkspaceResponse(thread_id=thread_id, workspace=str(ws))


@app.get("/api/workspaces/current")
async def get_current_workspace(thread_id: str | None = None):
    """Get the workspace for a session (or the default workspace)."""
    if thread_id:
        conn, _ = await get_db()
        async with conn.cursor() as cursor:
            await cursor.execute("SELECT workspace FROM session_meta WHERE thread_id = ?", (thread_id,))
            row = await cursor.fetchone()
            if row and row[0]:
                return {"workspace": row[0]}
    # Default workspace
    return {"workspace": str(Path(_DEFAULT_WORKSPACE).expanduser().resolve())}


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """
    Send a message and stream the response in real-time using agent.astream
    with stream_mode="messages", subgraphs=True, version="v2".
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    if not AGENT_AVAILABLE:
        raise HTTPException(status_code=500, detail=f"Agent not available: {AGENT_ERROR}")

    # Generate thread_id if not provided
    thread_id = request.thread_id or f"session-{uuid.uuid4().hex[:8]}"

    # Resolve workspace: explicit > session_meta > default
    workspace = request.workspace
    if not workspace:
        conn, _ = await get_db()
        async with conn.cursor() as cursor:
            await cursor.execute("SELECT workspace FROM session_meta WHERE thread_id = ?", (thread_id,))
            row = await cursor.fetchone()
            workspace = row[0] if row and row[0] else _DEFAULT_WORKSPACE
        # Resolve to absolute path
        workspace = str(Path(workspace).expanduser().resolve())

    async def event_stream():
        try:
            agent = await get_or_create_agent(workspace)
            config = {"configurable": {"thread_id": thread_id}}

            # Cache first_message and workspace in session_meta on first interaction
            try:
                conn, _ = await get_db()
                await conn.execute(
                    "INSERT OR IGNORE INTO session_meta (thread_id, first_message, workspace) VALUES (?, ?, ?)",
                    (thread_id, request.message[:50], workspace)
                )
                await conn.commit()
            except Exception:
                pass

            # Yield user message ACK
            yield format_sse("message", {
                "type": "human",
                "content": request.message,
            })

            turn_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

            # Track pending tool calls to accumulate input args before emitting
            pending_tools = {}  # index -> {name, id, args_str}

            async for chunk in agent.astream(
                {"messages": [{"role": "user", "content": request.message}]},
                stream_mode="messages",
                subgraphs=True,
                version="v2",
                config=config
            ):
                if not isinstance(chunk, dict):
                    continue

                if chunk.get("type") != "messages":
                    continue

                data = chunk.get("data")
                if not data or not isinstance(data, tuple) or len(data) == 0:
                    continue

                msg_obj = data[0]
                msg_type = str(getattr(msg_obj, 'type', type(msg_obj).__name__)).lower()

                # Ignore user messages
                if msg_type in ("human", "humanmessage", "user"):
                    continue

                # 1. Handle AIMessage / AIMessageChunk
                if msg_type in ("ai", "aimessagechunk", "aimessage"):

                    # Accumulate usage if present
                    if hasattr(msg_obj, 'usage_metadata') and msg_obj.usage_metadata:
                        u = msg_obj.usage_metadata
                        # Only read from final chunk to avoid double-counting
                        is_final = getattr(msg_obj, 'chunk_position', None) == 'last'
                        if is_final:
                            turn_usage["input_tokens"] = max(turn_usage["input_tokens"], u.get("input_tokens", 0))
                            turn_usage["output_tokens"] += u.get("output_tokens", 0)
                            turn_usage["total_tokens"] = turn_usage["input_tokens"] + turn_usage["output_tokens"]

                    # Parse message content (deltas / blocks)
                    content = getattr(msg_obj, 'content', None)
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict):
                                b_type = block.get("type")

                                # Track tool_use blocks to register pending tool calls
                                if b_type == "tool_use":
                                    idx = block.get("index")
                                    tool_name = block.get("name")
                                    tool_id = block.get("id")
                                    if idx is not None and tool_name:
                                        pending_tools[idx] = {
                                            "name": tool_name,
                                            "id": tool_id,
                                            "args_str": ""
                                        }
                                        # Don't emit tool_call here - wait for args to accumulate

                                elif b_type == "input_json_delta":
                                    # Accumulate partial JSON args for this tool
                                    idx = block.get("index")
                                    partial = block.get("partial_json", "") or ""
                                    if idx in pending_tools:
                                        pending_tools[idx]["args_str"] += partial

                                elif b_type == "thinking" and block.get("thinking"):
                                    yield format_sse("message", {
                                        "type": "thinking_delta",
                                        "content": block.get("thinking"),
                                    })
                                elif b_type == "text" and block.get("text"):
                                    yield format_sse("message", {
                                        "type": "text_delta",
                                        "content": block.get("text"),
                                    })
                    elif isinstance(content, str) and content:
                        yield format_sse("message", {
                            "type": "text_delta",
                            "content": content,
                        })

                # 2. Handle ToolMessage - emit combined card with input + result
                elif msg_type in ("tool", "toolmessage"):
                    tool_name = getattr(msg_obj, 'name', 'tool')
                    tool_content = getattr(msg_obj, 'content', '')
                    tool_id = getattr(msg_obj, 'id', None)

                    # Find the matching pending tool call
                    input_args = {}
                    tool_use_id = None
                    for p in pending_tools.values():
                        if p["id"] == tool_id:
                            # Try to parse accumulated args
                            try:
                                if p["args_str"]:
                                    input_args = json.loads(p["args_str"])
                            except (json.JSONDecodeError, Exception):
                                input_args = {"raw": p["args_str"]}
                            tool_use_id = p["id"]
                            break

                    # Remove from pending
                    if tool_use_id:
                        for idx, p in list(pending_tools.items()):
                            if p["id"] == tool_use_id:
                                del pending_tools[idx]
                                break

                    # Emit combined tool result with input args + output
                    yield format_sse("message", {
                        "type": "tool_result",
                        "name": tool_name,
                        "input": input_args,
                        "content": str(tool_content),
                    })

            # Stream Done Signal
            yield format_sse("done", {
                "thread_id": thread_id,
                "usage": turn_usage if turn_usage["total_tokens"] > 0 else None
            })

        except Exception as e:
            print(f"Error during streaming: {e}")
            yield format_sse("error", {"message": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# ============== Main ==============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
