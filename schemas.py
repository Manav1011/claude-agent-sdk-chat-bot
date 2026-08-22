"""Pydantic schemas for structured output in blocks mode."""

from pydantic import BaseModel, Field


class ContentBlock(BaseModel):
    """Single content block with markdown and spoken explanation.
    
    This is the LLM-generated response schema. The LLM produces ordered blocks,
    each containing markdown for visual rendering and a natural-language spoken
    explanation suitable for text-to-speech.
    
    The LLM must NOT generate UUID or sequence_id - these are server-generated.
    """
    
    markdown: str = Field(
        description="Markdown content for visual rendering. Can include code blocks, "
                   "headings, lists, tables, or any Markdown syntax."
    )
    spoken_explanation: str = Field(
        description="Natural-language explanation suitable for text-to-speech. "
                   "Should explain WHAT the content does, not read it literally. "
                   "For code: explain function/purpose. For logs: summarize key info. "
                   "For diffs: describe what changed and why."
    )


class AgentResponse(BaseModel):
    """Structured response containing ordered content blocks.
    
    This is the schema given to create_deep_agent as response_format.
    The LLM generates blocks in order.
    """
    
    blocks: list[ContentBlock] = Field(
        description="Ordered list of content blocks. Each block has markdown for "
                   "visual display and spoken_explanation for audio playback."
    )


class EnrichedContentBlock(BaseModel):
    """ContentBlock enriched with server-generated identity.
    
    After the LLM generates AgentResponse, the backend adds:
    - uuid: Server-generated UUID for stable block identity
    - sequence_id: 1-based sequential position within the response
    
    This enriched representation is what gets persisted and emitted via SSE.
    """
    
    uuid: str = Field(
        description="Stable across calls for the same block content. Deterministic hash from sequence_id and markdown content."
    )
    sequence_id: int = Field(
        description="1-based sequential position within the response."
    )
    markdown: str = Field(
        description="Markdown content from LLM."
    )
    spoken_explanation: str = Field(
        description="Spoken explanation from LLM."
    )


class Project(BaseModel):
    """A workspace project tracked by the server."""

    id: int
    name: str
    path: str
    created_at: str | None = None


class ProjectCreate(BaseModel):
    """Request to add a new project."""

    name: str
    path: str


class ProjectsListResponse(BaseModel):
    """Response listing all tracked projects."""

    projects: list[Project]


class ProjectSessionsResponse(BaseModel):
    """Sessions belonging to a specific project."""

    sessions: list


class SessionResponse(BaseModel):
    """A conversation session."""

    thread_id: str
    first_message: str
    created_at: str | None = None
