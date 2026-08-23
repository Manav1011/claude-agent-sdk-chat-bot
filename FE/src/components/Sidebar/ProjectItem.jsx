import React from 'react';
import { useChat } from '../../context/ChatContext';
import SessionItem from './SessionItem';

export default function ProjectItem({ project }) {
  const {
    activeProjectId,
    expandedProjects,
    loadingProjects,
    projectSessions,
    toggleProject,
    deleteProject,
    startNewChat,
    loadProjectSessions,
  } = useChat();

  const isExpanded = expandedProjects.has(project.id);
  const isActive = activeProjectId === project.id;
  const isLoading = loadingProjects.has(project.id);
  const sessions = projectSessions[project.id] || [];

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
    <div
      className={`project-card rounded-xl border transition-all ${
        isActive
          ? 'bg-dark-surface/70 border-dark-border/90 shadow-sm'
          : 'bg-dark-surface/30 border-dark-border/40 hover:border-dark-border/80'
      }`}
    >
      <div
        onClick={handleHeaderClick}
        className="project-header group px-2.5 py-2 rounded-xl cursor-pointer flex items-center justify-between hover:bg-dark-elevated/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
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

          <svg className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-brand' : 'text-txt-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>

          <span className={`text-xs truncate font-medium ${isActive ? 'text-white' : 'text-txt-muted group-hover:text-white'}`} title={project.path}>
            {project.name}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {sessions.length > 0 && !isExpanded && (
            <span className="text-[10px] font-mono text-txt-subtle bg-dark-bg/60 px-1.5 py-0.2 rounded-full border border-dark-border/40 group-hover:opacity-0 transition-opacity">
              {sessions.length}
            </span>
          )}

          <button
            type="button"
            onClick={handleNewChat}
            className="project-new-chat-btn opacity-0 group-hover:opacity-100 p-1 hover:text-brand text-txt-subtle transition-all cursor-pointer rounded hover:bg-dark-elevated"
            title={`New conversation in ${project.name}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="delete-project-btn opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-txt-subtle transition-all cursor-pointer rounded hover:bg-dark-elevated"
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
        <>
          {isLoading ? (
            <div className="py-2.5 px-4 text-center text-[10px] text-txt-subtle font-mono flex items-center justify-center gap-1.5">
              <svg className="w-3 h-3 animate-spin text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Loading conversations...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-2 px-4 text-[11px] text-txt-subtle flex items-center justify-between border-t border-dark-border/30 mt-1">
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
            <div className="pl-2 pr-1.5 py-1 space-y-1 border-l border-dark-border/60 ml-4 my-1">
              {sessions.map((s) => (
                <SessionItem key={s.thread_id} session={s} projectId={project.id} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
