import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import TabSwitcher from './TabSwitcher';

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
    openTabs,
  } = useChat();

  // Mobile tab-switcher sheet state
  const [switcherOpen, setSwitcherOpen] = useState(false);

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

  // Overflow menu state — mobile only.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="h-14 sm:h-12 px-3 sm:px-4 border-b border-dark-border/60 bg-dark-surface/40 backdrop-blur-md flex items-center justify-between shrink-0 relative">
      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-1.5 sm:p-1.5 text-txt-muted hover:text-white rounded-lg bg-dark-elevated hover:bg-dark-border border border-dark-border transition-colors cursor-pointer shrink-0"
          title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex flex-col min-w-0 justify-center flex-1">
          {/* Project badge — hidden on mobile to free title space. The 3px workspace
              stripe on the screen edge already carries the "which workspace" signal. */}
          {activeProject && (
            <div className="hidden sm:flex items-center gap-1 text-[10px] text-brand font-medium leading-none pb-0.5">
              <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span className="truncate max-w-[160px] sm:max-w-[240px] font-mono" title={activeProject.path}>
                {activeProject.name}
              </span>
            </div>
          )}
          <span
            className="font-medium text-sm text-white tracking-wide truncate leading-tight"
            title={chatTitle}
          >
            {chatTitle}
          </span>
        </div>
      </div>

      {/* Desktop right cluster — thoughts + settings, both visible on sm+ */}
      <div className="hidden sm:flex items-center gap-2">
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
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
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

      {/* Mobile-only tab switcher — browser-style "show all open tabs" sheet.
          Hidden on sm+ because the top TabBar already shows tabs on desktop. */}
      <div className="sm:hidden flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSwitcherOpen(true)}
          className="relative p-1.5 rounded-lg bg-dark-elevated hover:bg-dark-border border border-dark-border text-txt-muted hover:text-white transition-colors flex items-center justify-center cursor-pointer"
          title="Open tabs"
          aria-label="Open tabs"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
              d="M4 5a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM14 5a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2V5zM4 15a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 15a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4z"
            />
          </svg>
          {openTabs.length > 1 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand text-[9px] font-mono font-semibold text-white flex items-center justify-center pointer-events-none ring-2 ring-dark-bg">
              {openTabs.length}
            </span>
          )}
        </button>

        {/* Mobile-only overflow menu — single ⋯ button keeps the header clean. */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="p-1.5 rounded-lg bg-dark-elevated hover:bg-dark-border border border-dark-border text-txt-muted hover:text-white transition-colors flex items-center justify-center cursor-pointer"
            title="More"
          >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-dark-surface/95 backdrop-blur-md border border-dark-border/80 shadow-2xl py-1 z-50 text-sm"
          >
            {activeProject && (
              <div className="px-3 py-2 border-b border-dark-border/60">
                <div className="text-[10px] uppercase tracking-wider text-txt-subtle/80 mb-0.5">Workspace</div>
                <div className="text-brand font-medium truncate text-xs font-mono">{activeProject.name}</div>
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => { setExpandThoughts(!expandThoughts); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-dark-elevated text-txt-main flex items-center justify-between cursor-pointer"
            >
              <span>Auto-expand thoughts</span>
              <span className={`text-[11px] font-mono ${expandThoughts ? 'text-brand' : 'text-txt-subtle'}`}>
                {expandThoughts ? 'ON' : 'OFF'}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => { setIsSettingsOpen(true); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-dark-elevated text-txt-main flex items-center gap-2 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-txt-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Settings</span>
            </button>
          </div>
        )}
        </div>
      </div>

      <TabSwitcher isOpen={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </header>
  );
}
