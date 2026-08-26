import React, { useState, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import SessionItem from './SessionItem';

const STORAGE_KEY = 'qa-sidebar-expanded-projects';

function readExpandedSet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export default function ProjectItem({ project }) {
  const {
    expandedProjects,
    loadingProjects,
    projectSessions,
    projectSessionsMeta,
    toggleProject,
    deleteProject,
    startNewChat,
    loadProjectSessions,
    loadMoreSessions,
  } = useChat();

  const isExpanded = expandedProjects.has(project.id);
  const isLoading = loadingProjects.has(project.id);
  const sessions = projectSessions[project.id] || [];
  const sessionMeta = projectSessionsMeta?.[project.id] || {};
  const hasMore = !!sessionMeta.has_more;
  const loadingMore = !!sessionMeta.loading;

  const sorted = [...sessions].sort(
    (a, b) => (b.last_modified || 0) - (a.last_modified || 0)
  );

  const handleHeaderClick = (e) => {
    if (e.target.closest('.delete-project-btn') || e.target.closest('.project-new-chat-btn')) return;
    toggleProject(project.id);
  };

  const handleNewChat = (e) => {
    e.stopPropagation();
    if (!isExpanded) {
      toggleProject(project.id);
    }
    startNewChat(project.id);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm('Remove this project from sidebar tracking? (Files and conversations will be preserved)')) {
      deleteProject(project.id);
    }
  };

  return (
    <div className="project-card rounded-lg">
      <div
        onClick={handleHeaderClick}
        className="project-header group px-2 py-1.5 rounded-md cursor-pointer flex items-center justify-between hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <svg
            className={`project-chevron w-3 h-3 text-txt-subtle transition-transform duration-200 shrink-0 ${
              isExpanded ? 'rotate-90 text-brand' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
          </svg>

          <span className="text-xs truncate font-medium text-txt-muted group-hover:text-white" title={project.path}>
            {project.name}
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {sessions.length > 0 && (
            <span className="text-[9.5px] font-mono text-txt-subtle/70 bg-white/[0.04] px-1.5 py-0.5 rounded-full">
              {sessions.length}
            </span>
          )}

          <button
            type="button"
            onClick={handleNewChat}
            className="project-new-chat-btn opacity-0 group-hover:opacity-100 p-1 hover:text-brand text-txt-subtle transition-all cursor-pointer rounded hover:bg-white/[0.04]"
            title={`New conversation in ${project.name}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="delete-project-btn opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-txt-subtle transition-all cursor-pointer rounded hover:bg-white/[0.04]"
            title="Remove workspace from tracking"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-0.5">
          {isLoading ? (
            <div className="py-2 px-3 text-center text-[10px] text-txt-subtle font-mono flex items-center justify-center gap-1.5">
              <svg className="w-3 h-3 animate-spin text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Loading conversations…</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-2 px-3 text-[11px] text-txt-subtle flex items-center justify-between mt-0.5">
              <span className="italic">No chats yet</span>
              <button
                type="button"
                onClick={handleNewChat}
                className="text-[11px] text-brand hover:text-brand-hover font-medium underline cursor-pointer"
              >
                + Start chat
              </button>
            </div>
          ) : (
            <>
              {/* Tree connector: vertical line down the left, horizontal "branch" stubs. */}
              <div className="relative pl-5 ml-3.5 mt-0.5 space-y-0.5 before:absolute before:left-0 before:top-0 before:bottom-3 before:w-px before:bg-dark-border/70">
                {sorted.map((s, idx) => (
                  <div key={s.thread_id} className="relative">
                    {/* Horizontal branch stub connecting the tree line to the row */}
                    <span className="absolute -left-3.5 top-1/2 w-3 h-px bg-dark-border/70" aria-hidden="true" />
                    {idx === sorted.length - 1 && !hasMore && (
                      // Last row, nothing below: cap the vertical line at this row.
                      <span className="absolute -left-[1px] top-0 bottom-1/2 w-px bg-dark-surface/40" aria-hidden="true" />
                    )}
                    <SessionItem session={s} projectId={project.id} />
                  </div>
                ))}
              </div>
              {hasMore && (
                <div className="relative pl-5 ml-3.5">
                  <span className="absolute -left-3.5 top-1/2 w-3 h-px bg-dark-border/70" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => loadMoreSessions(project.id)}
                    disabled={loadingMore}
                    className="mt-1 text-[10.5px] text-txt-subtle hover:text-brand font-medium flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-white/[0.04] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                  >
                    <svg
                      className={`w-3 h-3 ${loadingMore ? 'animate-spin' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      {loadingMore ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 12a8 8 0 018-8M4 12a8 8 0 008 8" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      )}
                    </svg>
                    {loadingMore ? 'Loading…' : 'Show more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
