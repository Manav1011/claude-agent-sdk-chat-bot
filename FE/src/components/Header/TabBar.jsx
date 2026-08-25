import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '../../context/ChatContext';

export default function TabBar() {
  const {
    openTabs,
    currentThreadId,
    selectSession,
    closeTab,
    closeOtherTabs,
    closeTabsToLeft,
    closeTabsToRight,
    closeAllTabs,
    startNewChat,
    activeProjectId,
    projects,
    projectSessions,
    messages,
    activeStreams,
  } = useChat();

  const scrollRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, tab, tabsToRightCount, tabsToLeftCount }

  // Auto-scroll active tab into view
  useEffect(() => {
    if (!scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector('.active-session-tab');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [currentThreadId]);

  // Close the right-click menu on outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const onClick = (e) => {
      // Only close for clicks outside the menu.
      if (e.target.closest?.('[data-tab-context-menu]')) return;
      setContextMenu(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  if (!openTabs || openTabs.length === 0) {
    return null;
  }

  const getTabTitle = (tab) => {
    if (!tab.threadId) return 'New Conversation';
    if (tab.title && tab.title !== 'Conversation' && tab.title !== 'New Conversation' && tab.title !== tab.threadId) {
      return tab.title;
    }
    for (const list of Object.values(projectSessions || {})) {
      const found = list.find((s) => s.thread_id === tab.threadId);
      if (found && found.first_message && found.first_message !== tab.threadId) {
        return found.first_message;
      }
    }
    const msgs = messages[tab.threadId] || [];
    const human = msgs.find((m) => m.type === 'human');
    if (human && human.content) {
      return human.content.slice(0, 36);
    }
    return tab.title || 'Conversation';
  };

  return (
    <div className="h-7.5 sm:h-8.5 bg-[#0b0c10] border-b border-dark-border/70 flex items-center px-1.5 sm:px-2 select-none shrink-0 overflow-hidden">
      <div
        ref={scrollRef}
        className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 h-full py-0.5 sm:py-1 min-w-0"
      >
        {openTabs.map((tab, idx) => {
          const isActive =
            tab.threadId === currentThreadId ||
            (tab.threadId === null && currentThreadId === null);

          const proj = projects.find((p) => String(p.id) === String(tab.projectId));
          const tabTitle = getTabTitle(tab);
          const isTabStreaming = Boolean(tab.threadId && activeStreams?.[tab.threadId]?.isStreaming);

          return (
            <div
              key={tab.threadId || `new-tab-${idx}`}
              onClick={() => {
                if (tab.threadId) {
                  selectSession(tab.threadId, tab.projectId);
                } else {
                  startNewChat(tab.projectId);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  tab,
                  tabsToRightCount: openTabs.length - 1 - idx,
                  tabsToLeftCount: idx,
                });
              }}
              className={`group h-6 sm:h-7 px-2 sm:px-2.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-all duration-150 shrink-0 max-w-[145px] sm:max-w-[190px] border ${
                isActive
                  ? 'active-session-tab bg-dark-elevated text-white border-dark-border/90 font-medium shadow-sm'
                  : 'bg-transparent hover:bg-dark-surface/60 text-txt-muted hover:text-white border-transparent'
              }`}
              title={tabTitle}
            >
              {/* Status / Workspace indicator */}
              {isTabStreaming ? (
                <svg className="w-3 h-3 animate-spin text-brand shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg
                  className={`w-3 h-3 shrink-0 ${isActive ? 'text-brand' : 'text-txt-subtle'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.75"
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              )}

              {/* Title */}
              <span className="truncate flex-1 text-[11px] leading-tight">
                {tabTitle}
              </span>

              {/* Workspace Pill on inactive or hover */}
              {proj && (
                <span className="text-[9px] font-mono text-txt-subtle/80 bg-dark-bg/60 px-1 rounded truncate max-w-[50px] shrink-0 hidden sm:inline-block">
                  {proj.name}
                </span>
              )}

              {/* Close Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.threadId);
                }}
                className={`p-0.5 rounded hover:bg-dark-bg/80 text-txt-subtle hover:text-white transition-opacity shrink-0 ${
                  isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                title="Close tab"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}

        {/* New Tab Button */}
        <button
          type="button"
          onClick={() => startNewChat(activeProjectId)}
          className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-dark-surface text-txt-subtle hover:text-white transition-colors shrink-0 cursor-pointer ml-0.5 border border-transparent hover:border-dark-border/40"
          title="Open new conversation tab"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Right-click context menu for tab management */}
      {contextMenu && (
        <div
          data-tab-context-menu
          className="fixed z-50 bg-dark-surface/95 backdrop-blur-md border border-dark-border/80 rounded-lg shadow-2xl py-1 min-w-[180px] text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            disabled={openTabs.length <= 1}
            onClick={() => { closeOtherTabs(contextMenu.tab.threadId); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 hover:bg-dark-elevated text-txt-main disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
          >
            Close other tabs
          </button>
          <button
            type="button"
            disabled={contextMenu.tabsToRightCount === 0}
            onClick={() => { closeTabsToRight(contextMenu.tab.threadId); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 hover:bg-dark-elevated text-txt-main disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
          >
            Close tabs to the right
          </button>
          <button
            type="button"
            disabled={contextMenu.tabsToLeftCount === 0}
            onClick={() => { closeTabsToLeft(contextMenu.tab.threadId); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 hover:bg-dark-elevated text-txt-main disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
          >
            Close tabs to the left
          </button>
          <div className="border-t border-dark-border/60 my-1" />
          <button
            type="button"
            disabled={openTabs.length === 0}
            onClick={() => { closeAllTabs(); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 hover:bg-rose-500/15 text-rose-300 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
          >
            Close all tabs
          </button>
        </div>
      )}
    </div>
  );
}
