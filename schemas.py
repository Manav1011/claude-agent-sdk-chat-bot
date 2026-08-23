"""Pydantic schemas for explainer-bot API."""

from pydantic import BaseModel, Field


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
