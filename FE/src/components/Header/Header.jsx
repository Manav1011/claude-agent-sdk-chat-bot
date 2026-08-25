import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function Header() {
  const {
    toggleSidebar,
    isSidebarOpen,
    setIsSettingsOpen,
    currentThreadId,
    projectSessions,
    activeProjectId,
    projects,
    messages,
    expandThoughts,
    setExpandThoughts,
  } = useChat();

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const currentSession = (projectSessions[activeProjectId] || []).find(
    (s) => s.thread_id === currentThreadId
  );
  const firstHumanMsg = (messages[currentThreadId] || []).find((m) => m.type === 'human');
  const chatTitle =
    currentSession?.first_message && currentSession.first_message !== currentThreadId
      ? currentSession.first_message
      : firstHumanMsg?.content
      ? firstHumanMsg.content
      : 'New Conversation';

  return (
    <header className="h-10 sm:h-12 px-2.5 sm:px-4 border-b border-dark-border/60 bg-dark-surface/40 backdrop-blur-md flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-1 sm:p-1.5 text-txt-muted hover:text-white rounded-lg bg-dark-elevated hover:bg-dark-border border border-dark-border transition-colors cursor-pointer shrink-0"
          title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex flex-col min-w-0 justify-center">
          {activeProject && (
            <div className="flex items-center gap-1 text-[10px] text-brand font-medium leading-none pb-0.5">
              <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span className="truncate max-w-[160px] sm:max-w-[240px]" title={activeProject.path}>
                {activeProject.name}
              </span>
            </div>
          )}
          <span
            className="font-medium text-xs sm:text-sm text-white tracking-wide truncate max-w-[200px] sm:max-w-md md:max-w-lg lg:max-w-xl leading-tight"
            title={chatTitle}
          >
            {chatTitle}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpandThoughts(!expandThoughts)}
          title={expandThoughts ? 'Auto-expand thoughts: ON' : 'Auto-expand thoughts: OFF'}
          aria-pressed={expandThoughts}
          className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center cursor-pointer ${
            expandThoughts
              ? 'bg-brand/15 border-brand/40 text-brand hover:bg-brand/25'
              : 'bg-dark-elevated hover:bg-dark-border border-dark-border text-txt-muted hover:text-white'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          title="Settings"
          className="p-1.5 rounded-lg bg-dark-elevated hover:bg-dark-border border border-dark-border text-txt-muted hover:text-white transition-colors flex items-center justify-center cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
