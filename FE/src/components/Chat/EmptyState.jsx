import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function EmptyState() {
  const { activeProjectId, projects, projectSessions } = useChat();
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const sessionCount = (activeProjectId && projectSessions[activeProjectId]?.length) || 0;

  return (
    <div className="h-full flex flex-col items-center justify-center text-center my-auto px-6 py-10 w-full max-w-[65ch] sm:max-w-2xl lg:max-w-4xl mx-auto">
      {/* ponytail: smaller hero on mobile — the original 48px square felt oversized at
          430px width and pushed the project name off the visible area. */}
      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-brand/20 to-amber-500/10 border border-brand/30 flex items-center justify-center mb-3 sm:mb-4 shadow-glow">
        <svg className="w-5 h-5 sm:w-6 sm:h-6 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
      </div>

      {activeProject ? (
        <>
          <div className="flex items-center gap-1.5 text-[11px] text-brand font-medium leading-none mb-1.5 uppercase tracking-wider">
            <span>Active workspace</span>
          </div>
          <h2 className="text-base sm:text-lg font-semibold text-white mb-1.5 break-words">
            {activeProject.name}
          </h2>
          <p
            className="text-txt-subtle text-[10.5px] sm:text-[11px] font-mono max-w-md mb-2 truncate px-4"
            title={activeProject.path}
          >
            {activeProject.path}
          </p>
          <p className="text-txt-muted text-xs sm:text-sm max-w-md mb-1 leading-relaxed">
            {sessionCount === 0
              ? 'No conversations yet.'
              : `${sessionCount} conversation${sessionCount === 1 ? '' : 's'} in this workspace.`}
          </p>
          <p className="text-txt-subtle text-[11px] sm:text-xs mt-4 sm:mt-6 max-w-md">
            Type a message below to start a new conversation.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-base sm:text-lg font-semibold text-white mb-1.5">
            No workspace selected
          </h2>
          <p className="text-txt-muted text-xs sm:text-sm max-w-md mb-4 sm:mb-6 leading-relaxed">
            Add a project from the sidebar to start chatting.
          </p>
        </>
      )}
    </div>
  );
}
