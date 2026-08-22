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

import aiosqlite

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
from claude_agent_sdk import ResultMessage, StreamEvent, list_sessions as sdk_list_sessions

from schemas import ContentBlock, AgentResponse, EnrichedContentBlock

HOST = "0.0.0.0"
PORT = 8225

LLM_API_KEY = os.environ.get("LLM_API_KEY", "97f5482590888eaa0afe9e173babd87c9abae1f5")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8083/anthropic")

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


# ============== Lifespan ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    global _db_conn, _WORKSPACE_CLIENTS
    _WORKSPACE_CLIENTS.clear()
    if _db_conn:
        try:
            await _db_conn.close()
            print("Database connection closed gracefully.")
        except Exception as e:
            print(f"Error closing DB: {e}")
        _db_conn = None


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
_db_conn = None
_db_lock = asyncio.Lock()
_cache_lock = asyncio.Lock()


# ============== SDK Helpers ==============

def _sdk_project_key(workspace: str) -> str:
    """Compute SDK project-key from workspace path."""
    return "-" + os.path.realpath(workspace).lstrip("/").replace("/", "-")


def _read_sdk_history(workspace: str, session_id: str) -> list[dict]:
    """Read conversation history from SDK JSONL file.

    session_id IS the SDK session_id — SDK stores at
    ~/.claude/projects/<project-key>/<session_id>.jsonl
    """
    project_key = _sdk_project_key(workspace)
    jsonl_path = Path.home() / ".claude" / "projects" / project_key / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return []

    messages = []
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue

            entry_type = entry.get("type", "")
            if entry_type == "user":
                msg = entry.get("message", {})
                content = msg.get("content", "")
                if isinstance(content, str):
                    messages.append({"type": "human", "content": content})
                elif isinstance(content, list):
                    texts = [c.get("text", "") for c in content if c.get("type") == "text"]
                    if texts:
                        messages.append({"type": "human", "content": "".join(texts)})

            elif entry_type == "assistant":
                msg = entry.get("message", {})
                content = msg.get("content", [])
                if isinstance(content, list):
                    texts = []
                    for block in content:
                        if block.get("type") == "text":
                            texts.append(block.get("text", ""))
                        elif block.get("type") == "thinking":
                            pass  # skip thinking
                    if texts:
                        messages.append({"type": "ai", "content": "".join(texts)})
    return messages


def _read_sdk_history_and_blocks(workspace: str, session_id: str) -> tuple[list[dict], list[dict]]:
    """Read conversation history and enriched blocks from SDK JSONL file.

    SDK stores structured output as:
      {type: "assistant", message: {content: [{type: "tool_use", name: "StructuredOutput", input: {blocks: [...]}}]}}
    """
    project_key = _sdk_project_key(workspace)
    jsonl_path = Path.home() / ".claude" / "projects" / project_key / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return [], []

    messages = []
    enriched_blocks = []

    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue

            entry_type = entry.get("type", "")

            if entry_type == "user":
                msg = entry.get("message", {})
                content = msg.get("content", "")
                if isinstance(content, str):
                    messages.append({"type": "human", "content": content})
                elif isinstance(content, list):
                    texts = [c.get("text", "") for c in content if c.get("type") == "text"]
                    if texts:
                        messages.append({"type": "human", "content": "".join(texts)})

            elif entry_type == "assistant":
                msg = entry.get("message", {})
                content = msg.get("content", [])
                if isinstance(content, list):
                    texts = []
                    for block in content:
                        if block.get("type") == "text":
                            texts.append(block.get("text", ""))
                        elif block.get("type") == "tool_use" and block.get("name") == "StructuredOutput":
                            input_data = block.get("input", {})
                            raw_blocks = input_data.get("blocks", [])
                            if raw_blocks:
                                try:
                                    from schemas import ContentBlock
                                    content_blocks = [ContentBlock(**b) for b in raw_blocks]
                                    enriched = _enrich_blocks(content_blocks)
                                    enriched_blocks.extend([b.model_dump() for b in enriched])
                                except Exception as e:
                                    print(f"[WARN] Failed to parse StructuredOutput blocks: {e}")
                        elif block.get("type") == "thinking":
                            pass  # skip thinking
                    if texts:
                        messages.append({"type": "ai", "content": "".join(texts)})

    return messages, enriched_blocks


def _build_options(workspace: str, session_id: str | None = None, resume: bool = False) -> ClaudeAgentOptions:
    opts = ClaudeAgentOptions(
        model="Minimax-M2.7",
        env={
            "ANTHROPIC_API_KEY": LLM_API_KEY,
            "ANTHROPIC_BASE_URL": LLM_BASE_URL,
        },
        cwd=workspace,
        resume=session_id if resume else None,
        session_id=session_id if not resume else None,
        include_partial_messages=True,
    )
    return opts


# ============== Database (per-message enriched_blocks) ==============

async def get_db():
    """Get persistent SQLite connection for enriched_blocks."""
    global _db_conn
    if _db_conn is not None:
        return _db_conn

    async with _db_lock:
        # Double-check after acquiring lock
        if _db_conn is not None:
            return _db_conn
        try:
            _db_conn = await aiosqlite.connect(
                str(Path(__file__).parent / "chat_memory.db")
            )
            await _db_conn.execute("""
                CREATE TABLE IF NOT EXISTS enriched_blocks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id TEXT NOT NULL,
                    message_index INTEGER NOT NULL,
                    blocks_json TEXT NOT NULL
                )
            """)
            await _db_conn.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS
                    uq_enriched_blocks_thread_message
                ON enriched_blocks (thread_id, message_index)
            """)
            await _db_conn.commit()
        except Exception as e:
            print(f"[ERROR] Failed to initialize DB: {e}")
            raise

    return _db_conn


async def _persist_enriched_blocks(
    session_id: str, blocks: list[EnrichedContentBlock], message_index: int = 0
) -> None:
    """Persist blocks for a specific message in a session.

    message_index=0 is the first message in a thread, 1 is the second, etc.
    """
    conn = await get_db()
    blocks_json = json.dumps([b.model_dump() for b in blocks])
    await conn.execute(
        """INSERT OR REPLACE INTO enriched_blocks
           (thread_id, message_index, blocks_json)
           VALUES (?, ?, ?)""",
        (session_id, message_index, blocks_json),
    )
    await conn.commit()


async def _get_enriched_blocks(session_id: str) -> list[EnrichedContentBlock] | None:
    """Get the latest message's blocks for a session (message_index=0)."""
    conn = await get_db()
    async with conn.cursor() as cursor:
        await cursor.execute(
            """SELECT blocks_json FROM enriched_blocks
               WHERE thread_id = ?
               ORDER BY message_index DESC LIMIT 1""",
            (session_id,),
        )
        row = await cursor.fetchone()
        if row and row[0]:
            try:
                blocks_data = json.loads(row[0])
                return [EnrichedContentBlock(**b) for b in blocks_data]
            except json.JSONDecodeError:
                return None
    return None


# ============== SSE Helper ==============

def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ============== Models ==============

class ChatRequest(BaseModel):
    message: str
    thread_id: str | None = None
    workspace: str | None = None
    response_mode: Literal["normal", "blocks"] = "normal"


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
    enriched_blocks: list[dict] | None = None


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
async def list_sessions(workspace: str | None = None):
    """List sessions using SDK — no DB needed."""
    if workspace:
        ws = str(Path(workspace).expanduser().resolve())
    else:
        ws = _DEFAULT_WORKSPACE

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
async def get_session_messages(session_id: str, workspace: str | None = None):
    # Validate — SDK session_id must be UUID; if invalid, return empty history
    try:
        uuid.UUID(session_id)
    except ValueError:
        return MessagesResponse(session_id=session_id, messages=[], enriched_blocks=None)
    """Read conversation history from SDK JSONL file."""
    if workspace:
        ws = str(Path(workspace).expanduser().resolve())
    else:
        ws = _DEFAULT_WORKSPACE

    messages, enriched_blocks = _read_sdk_history_and_blocks(ws, session_id)

    return MessagesResponse(
        session_id=session_id,
        messages=messages,
        enriched_blocks=enriched_blocks if enriched_blocks else None,
    )


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete enriched_blocks entry (SDK JSONL deletion is not supported)."""
    conn = await get_db()
    try:
        async with conn.cursor() as cursor:
            await cursor.execute("DELETE FROM enriched_blocks WHERE thread_id = ?", (session_id,))
        await conn.commit()
    except Exception as e:
        print(f"Error deleting session {session_id}: {e}")
    return {"status": "deleted", "session_id": session_id}


@app.delete("/api/sessions")
async def delete_all_sessions():
    """Delete all enriched_blocks (SDK JSONL deletion not supported)."""
    conn = await get_db()
    try:
        async with conn.cursor() as cursor:
            await cursor.execute("DELETE FROM enriched_blocks")
        await conn.commit()
    except Exception as e:
        print(f"Error deleting all sessions: {e}")
    return {"status": "deleted_all"}


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

    # Resolve workspace
    workspace = request.workspace or _DEFAULT_WORKSPACE
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
        blocks_mode = request.response_mode == "blocks"
        opts = _build_options(workspace=workspace, session_id=session_id, resume=session_exists)

        if blocks_mode:
            opts.output_format = {
                "type": "json_schema",
                "schema": AgentResponse.model_json_schema(),
            }

        pending_tools: dict[int, dict] = {}
        turn_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

        try:
            # Reuse cached client for this session to enable get_context_usage()
            cache_key = f"{workspace}:{session_id}"
            async with _cache_lock:
                if cache_key in _WORKSPACE_CLIENTS:
                    client = _WORKSPACE_CLIENTS[cache_key]
                else:
                    client = ClaudeSDKClient(options=opts)
                    await client.connect()
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
                    print(f"[USAGE] input={turn_usage['input_tokens']} output={turn_usage['output_tokens']} total={turn_usage['total_tokens']} model_usage={msg.model_usage} usage={msg.usage} cost=${msg.total_cost_usd}")
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

                    # Blocks mode: structured output
                    if blocks_mode:
                        if not msg.structured_output:
                            # LLM did not return structured output — emit error and fall back
                            yield format_sse("error", {
                                "message": "LLM did not return structured blocks. Falling back to normal mode.",
                            })
                            yield format_sse("done", {
                                "thread_id": session_id,
                                "usage": turn_usage if turn_usage["total_tokens"] > 0 else None,
                                "response_mode": "normal",
                            })
                            return

                        try:
                            agent_resp = AgentResponse(**msg.structured_output)
                        except Exception as e:
                            yield format_sse("error", {
                                "message": f"Structured output validation failed: {e}",
                            })
                            yield format_sse("done", {
                                "thread_id": session_id,
                                "usage": turn_usage if turn_usage["total_tokens"] > 0 else None,
                                "response_mode": "normal",
                            })
                            return

                        enriched = _enrich_blocks(agent_resp.blocks)

                        # Emit content_block SSE events FIRST
                        for block in enriched:
                            yield format_sse("message", {
                                "type": "content_block",
                                "uuid": block.uuid,
                                "sequence_id": block.sequence_id,
                                "markdown": block.markdown,
                                "spoken_explanation": block.spoken_explanation,
                            })

                        # THEN persist to DB — failure here does not lose blocks from the user
                        try:
                            await _persist_enriched_blocks(session_id, enriched)
                        except Exception as e:
                            print(f"[WARN] Failed to persist blocks: {e}")
                            # Non-fatal: blocks were already delivered to the client

                        yield format_sse("done", {
                            "thread_id": session_id,
                            "usage": turn_usage if turn_usage["total_tokens"] > 0 else None,
                            "response_mode": "blocks",
                            "block_count": len(enriched),
                        })
                        return

                    yield format_sse("done", {
                        "thread_id": session_id,
                        "usage": turn_usage if turn_usage["total_tokens"] > 0 else None,
                        "response_mode": "normal",
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


# ============== Block Enrichment Helpers ==============

def _enrich_blocks(blocks: list[ContentBlock]) -> list[EnrichedContentBlock]:
    return [
        EnrichedContentBlock(
            uuid=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{i}:{b.markdown[:200]}")),
            sequence_id=i + 1,
            markdown=b.markdown,
            spoken_explanation=b.spoken_explanation,
        )
        for i, b in enumerate(blocks)
    ]


# ============== Main ==============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
