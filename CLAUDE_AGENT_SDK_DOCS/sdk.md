Claude Agent SDK — Complete Documentation Research
1. What It Is
The Claude Agent SDK (formerly the Claude Code SDK, renamed in v0.1.0) is a Python and TypeScript library that embeds Claude Code's autonomous agent loop into your own applications. Instead of calling Claude via a simple API, you get the full Claude Code experience: tool use, hooks, subagents, MCP servers, permissions, skills, and memory — all running as a claude CLI subprocess.

Package names:

Python: claude-agent-sdk
TypeScript: @anthropic-ai/claude-agent-sdk
2. The Agent Loop (Core Architecture)
The SDK's core loop runs Claude → tools → Claude → ... → done, repeating autonomously until the task is complete or a limit is reached.

Key control knobs:

Option	Python	TypeScript	Default	Description
max_turns	max_turns	maxTurns	unlimited	Number of agent turns
max_budget_usd	max_budget_usd	maxBudgetUsd	none	Stop when cost exceeds this
permission_mode	permission_mode	permissionMode	"default"	Tool permission behavior
effort	effort	effort	"medium"	Reasoning depth
Effort levels: low → medium → high → xhigh → max (controls how deeply Claude reasons)

Turns and messages: The agent loop produces a stream of 5 message types:

SystemMessage — init, compact_boundary, informational
AssistantMessage — Claude's response with text and/or tool use blocks
UserMessage — Tool results and user inputs
StreamEvent — Real-time text and tool call deltas (when streaming enabled)
ResultMessage — Final outcome: success, error_max_turns, error_max_budget_usd, error_during_execution, error_model, etc.
Context window management:

The SDK tracks tokens consumed (system prompt + conversation + tools)
When the window fills, automatic compaction summarizes older messages and emits a compact_boundary system message
Compact boundary messages carry a token report: pre_tokens, post_tokens, compacted_messages
3. Input Patterns
Single message input (one-shot):


async for message in query(prompt="..."):
    ...
Stateless: one task per call
No image uploads or mid-session control
Best for simple queries
Streaming input (persistent session):


async with ClaudeSDKClient(ClaudeAgentOptions()) as client:
    await client.query("task 1")
    async for msg in client.receive_response():
        ...
    await client.query("follow up")
    await client.query("/clear")  # reset context
    await client.query("/compact")  # compress history
Persistent connection across multiple turns
Supports image uploads, /compact, /clear
Real-time interruption (send Ctrl+C-style abort)
4. Output & Streaming
Streaming output:


for await (const message of query({
  prompt: "...",
  options: { includePartialMessages: true } // or include_partial_messages=True
})) {
  // StreamEvent messages carry real-time text and tool call deltas
}
StreamEvent types: message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop

Each StreamEvent carries a UUID, session_id, event type, and parent_tool_use_id. Text deltas appear as content_block_delta with delta.type === "text_delta"; tool call JSON appears as delta.type === "tool_use_delta".

5. Built-in Tools
Tool	Description
Bash	Run shell commands
Read	Read files
Edit	Edit files (diff-based)
Write	Create/overwrite files
Glob	Pattern-based file search
Grep	Regex file search
NotebookEdit	Edit Jupyter notebooks
Agent	Spawn subagents
WebSearch	Web search
WebFetch	Fetch URLs
ToolSearch	Dynamic tool discovery
Skill	Invoke skills
TaskCreate/TaskUpdate/TaskList/TaskGet	Task tracking (newer models)
TodoWrite	Todo tracking (older models)
AskUserQuestion	Ask clarifying questions
Workflow	Orchestrate subagents
Tools run in parallel when marked readOnlyHint: true.

6. Custom Tools
Define tools via the in-process MCP server:

Python:


@tool("get_temperature", "Get temperature at a location", {"latitude": float, "longitude": float})
async def get_temperature(args):
    async with httpx.AsyncClient() as client:
        response = await client.get("https://api.open-meteo.com/v1/forecast", params={...})
    return {"content": [{"type": "text", "text": f"Temperature: {data['current']['temperature_2m']}°F"}]}

server = create_sdk_mcp_server(name="weather", version="1.0.0", tools=[get_temperature])
TypeScript:


const getTemp = tool(
  "get_temperature", "Get temperature",
  { latitude: z.number(), longitude: z.number() },
  async (args) => ({ content: [{ type: "text", text: `Temperature: ${data.current.temperature_2m}°F` }] })
);
const server = createSdkMcpServer({ name: "weather", version: "1.0.0", tools: [getTemp] });
Tool names follow mcp__<server>__<tool> convention. Register via allowedTools to pre-approve.

Tool annotations control behavior metadata:

readOnlyHint: true — enables parallel execution
destructiveHint — informational
idempotentHint — informational
openWorldHint — informational
Return types: content (text/image/audio/resource), structuredContent (machine-readable JSON, Python SDK doesn't support this — use standalone MCP server instead), isError: true (signal failure to Claude).

7. MCP Integration
Connect external tools via 3 transport types:

Transport	When to use	Example
stdio	Local processes	command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"]
HTTP/SSE	Cloud-hosted servers	type: "http", url: "https://api.example.com/mcp"
SDK (in-process)	Custom tools in code	See "Custom Tools" above
Configuration via code (mcpServers option) or .mcp.json file. Authentication via env field or headers. Tool search defers loading tool schemas until needed.

8. Tool Search
Enables scaling to thousands of tools by deferring tool definition loading:

Tool definitions are withheld from context; Claude searches and loads only needed ones
Max 10,000 tools in catalog
Max 5 results per search by default
On by default; off for unsupported models and Microsoft Foundry Azure
Configuration:


ENABLE_TOOL_SEARCH=true    # always on (default)
ENABLE_TOOL_SEARCH=false   # always off
ENABLE_TOOL_SEARCH=auto    # on when deferrable definitions reach 10% of context
ENABLE_TOOL_SEARCH=auto:5  # on at 5% threshold
9. Permissions
6-step evaluation flow: Hooks → Deny rules → Ask rules → Permission mode → Allow rules → canUseTool callback

Permission modes:

Mode	Behavior
default	Standard — unmatched tools trigger callback
dontAsk	Deny everything not pre-approved
acceptEdits	Auto-approve file edits + filesystem ops
bypassPermissions	Approve everything except critical-path removals
plan	Explore/plan without editing files
auto	Model-classified approvals (beta)
Allow/deny rules:

allowed_tools=["Read", "Grep"] — pre-approve these tools
disallowed_tools=["Bash"] — remove from context entirely
disallowed_tools=["Bash(rm *)"] — scoped deny (still available, calls denied)
disallowed_tools=["*"] — remove everything
10. Hooks
Callback functions that intercept agent events at key execution points:

Hook types:

PreToolUse — before tool executes; can allow/deny/modify
PostToolUse — after tool executes; can see results
UserPromptSubmit — before user prompt reaches Claude
Stop — when execution stops
SubagentStart/Stop — subagent lifecycle
PreCompact — before compaction
Configuration:

Programmatic: options.hooks with callback functions
Shell command hooks from settings files
Hooks can:

Block dangerous operations
Log/audit tool calls
Transform inputs/outputs
Require human approval
Track session lifecycle
11. Subagents
Isolated agents with fresh conversation context, invoked via the Agent tool:

Definition:


AgentDefinition(
    description="Expert code review specialist",
    prompt="You are a code review specialist...",
    tools=["Read", "Grep", "Glob"],
    model="sonnet",
)
Benefits:

Context isolation — each subagent in its own conversation
Parallelization — multiple subagents run concurrently
Specialized instructions — tailored prompts per agent
Tool restrictions — limit what each subagent can do
Control limits:

Depth: CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH (default: 3)
Concurrency: CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS (default: 20)
Spend: maxBudgetUsd / max_budget_usd
Resume subagents: Capture agentId from the Agent tool result, then resume: sessionId to continue.

12. Structured Outputs
Define JSON Schema to get validated typed data back:


schema = {
    "type": "object",
    "properties": {
        "company_name": {"type": "string"},
        "founded_year": {"type": "number"},
        "headquarters": {"type": "string"},
    },
    "required": ["company_name"],
}

async for message in query(
    prompt="Research Anthropic...",
    options=ClaudeAgentOptions(
        output_format={"type": "json_schema", "schema": schema}
    ),
):
    if isinstance(message, ResultMessage) and message.structured_output:
        print(message.structured_output)
Type-safe schemas:

TypeScript: Zod (z.toJSONSchema(schema, { target: "draft-7" }))
Python: Pydantic (.model_json_schema())
Error handling:

success — validated successfully
error_max_structured_output_retries — validation failed after retries
13. Sessions
Session types:

Type	Description
One-shot	query() returns after completion
Multi-turn	ClaudeSDKClient / streamInput() for persistent sessions
Resume	resume: sessionId to continue an existing session
Fork	forkSession: true to branch session history
Session Store: Mirror transcripts to S3/Redis/Postgres for multi-host resume via SessionStore interface.

14. System Prompts
Four approaches:

Approach	Use Case
claude_code preset	CLI/IDE-like coding tools
claude_code preset + append	Same, with custom instructions
Custom prompt string	Different identity/surface/permission model
No systemPrompt	Minimal tool-calling loop, no agent persona
CLAUDE.md — persistent project context injected as conversation context (not system prompt). Load via settingSources.

Output styles — saved markdown configs that modify system prompts, reusable across sessions.

15. Skills & Plugins
Skills: Filesystem-based capability packages (SKILL.md files).

Defined as .claude/skills/<name>/SKILL.md
Discovered from settingSources
Invoked automatically by Claude or via /command-name
Plugins: Extensible framework for skills, agents, hooks, and MCP servers.

Load via plugins: [{ type: "local", path: "./my-plugin" }]
Skills namespaced as plugin-name:skill-name
16. Cost Tracking
Per-step usage on assistant messages, cumulative total on result messages:

total_cost_usd — cumulative estimated cost
modelUsage / model_usage — per-model breakdown
usage — tokens (excludes subagents)
Cache tokens: cache_read_input_tokens, cache_creation_input_tokens
Important: These are client-side estimates, not authoritative billing data.

17. Observability
OpenTelemetry integration:

Metrics: token counts, cost, sessions, tool decisions
Log events: prompts, API requests, tool results
Traces: interaction spans, LLM requests, tool calls (beta)
Environment variables:


CLAUDE_CODE_ENABLE_TELEMETRY=1
CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.example.com:4318
Trace propagation: Automatically injects W3C trace context into subprocess for unified tracing.

18. File Checkpointing
Rewind file changes to any previous state during an agent session:


options = ClaudeAgentOptions(
    enable_file_checkpointing=True,
    extra_args={"replay-user-messages": None},
)
Captures checkpoint UUIDs from user messages
rewind_files(checkpoint_id) restores files to that state
Tracks Write/Edit/NotebookEdit tools only (not Bash)
Works within the same session or across resumed sessions
19. Hosting & Deployment
Subprocess model: Every agent session = one claude CLI subprocess with its own shell, working directory, and JSONL transcripts.

Session patterns:

Pattern	Description	Best for
Ephemeral	Container per task, destroyed when done	Bug fixes, invoice extraction
Long-running	Persistent containers, multiple sessions	Email agents, chat bots
Hybrid	Ephemeral + SessionStore persistence	Research that pauses/resumes
Multi-agent	Multiple subprocesses in one container	Collaborative agents
Scaling formula: agents per host = (host RAM - overhead) / (per-session RAM ceiling)

Multi-tenant isolation:


ClaudeAgentOptions(
    setting_sources=[],  # No filesystem settings
    env={
        "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
        "CLAUDE_CONFIG_DIR": config_dir,
    },
)
Security hardening:

Container isolation (Docker, gVisor, Firecracker)
Proxy pattern for credential injection
Network controls (egress allowlists, Unix socket)
Read-only code mounting
ANTHROPIC_BASE_URL for sampling proxy
20. Migration from Claude Code SDK
Key changes in v0.1.0:

Package rename: @anthropic-ai/claude-code → @anthropic-ai/claude-agent-sdk
Python: claude_code_sdk → claude_agent_sdk, ClaudeCodeOptions → ClaudeAgentOptions
System prompt is no longer default — must explicitly set system_prompt={"type": "preset", "preset": "claude_code"} to get Claude Code's full prompt
Settings sources default changed (reverted to loading user/project/local by default)