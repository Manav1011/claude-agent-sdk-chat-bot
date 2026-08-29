import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from '../../context/ChatContext';

// Mobile-only bottom sheet — browser-style tab switcher. Each card = one
// open chat, showing workspace name + title + close-x. Active card highlighted.
// Desktop path is the top TabBar; this component returns null on lg+.
export default function TabSwitcher({ isOpen, onClose }) {
  const {
    openTabs,
    currentThreadId,
    selectSession,
    closeTab,
    startNewChat,
    projects,
    projectSessions,
    messages,
  } = useChat();

  // Esc to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Lock body scroll while sheet is open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Mobile only — desktop already has the top TabBar
  if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches) {
    return null;
  }

  if (!isOpen) return null;

  // ponytail: the header has backdrop-blur-md which creates a containing block
  // for fixed descendants. Without a portal, this sheet was being clipped to
  // the 56px header height instead of the viewport. Portal escapes that.
  if (typeof document === 'undefined') return null;

  const getTabTitle = (tab) => {
    if (!tab.threadId) return 'New Conversation';
    if (
      tab.title &&
      tab.title !== 'Conversation' &&
      tab.title !== 'New Conversation' &&
      tab.title !== tab.threadId
    ) {
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
    if (human && human.content) return human.content;
    return tab.title || 'Conversation';
  };

  const switchHere = (tab) => {
    if (tab.threadId) selectSession(tab.threadId, tab.projectId);
    else startNewChat(tab.projectId);
    onClose();
  };

  return createPortal(
    <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        onMouseDown={(e) => e.stopPropagation()}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Open tabs"
        className="relative bg-dark-surface border-t border-dark-border/80 rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col animate-sheet-up"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="sheet-handle" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-dark-border/60 shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-txt-subtle/80 font-medium">
              Open Tabs
            </div>
            <div className="text-sm font-semibold text-white">
              {openTabs.length} {openTabs.length === 1 ? 'conversation' : 'conversations'}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-2.5 -mr-1 rounded-lg hover:bg-dark-elevated text-txt-main active:bg-dark-border transition-colors cursor-pointer pointer-events-auto relative z-10"
            aria-label="Close"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 overscroll-contain">
          {openTabs.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-txt-subtle border border-dashed border-dark-border/80 rounded-xl">
              <div className="font-medium text-txt-muted mb-1">No open tabs</div>
              <div>Start a new conversation below.</div>
            </div>
          ) : (
            openTabs.map((tab) => {
              const isActive =
                tab.threadId === currentThreadId ||
                (tab.threadId === null && currentThreadId === null);
              const proj = projects.find((p) => String(p.id) === String(tab.projectId));
              const title = getTabTitle(tab);
              const canClose = openTabs.length > 1;

              return (
                <div
                  key={tab.threadId || `new-${tab.projectId}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive}
                  onClick={() => switchHere(tab)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      switchHere(tab);
                    }
                  }}
                  className={`group relative rounded-xl border p-3 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-brand/40 ${
                    isActive
                      ? 'bg-dark-elevated/80 border-brand/70'
                      : 'bg-dark-bg/40 border-dark-border/60 hover:border-dark-border hover:bg-dark-elevated/60 active:scale-[0.99]'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* Status dot */}
                    <div className="pt-1.5 shrink-0">
                      <span
                        className={`block w-2 h-2 rounded-full ${
                          isActive ? 'bg-brand animate-pulse' : 'bg-txt-subtle/40'
                        }`}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      {proj && (
                        <div className="flex items-center gap-1 mb-1">
                          <svg
                            className="w-2.5 h-2.5 text-brand/70 shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                            />
                          </svg>
                          <span
                            className="text-[10px] font-mono text-brand/80 truncate"
                            title={proj.path || proj.name}
                          >
                            {proj.name}
                          </span>
                        </div>
                      )}
                      <div
                        className={`text-sm leading-snug ${
                          isActive ? 'text-white font-medium' : 'text-txt-main'
                        }`}
                      >
                        <span className="line-clamp-2 break-words">{title}</span>
                      </div>
                      {isActive && (
                        <div className="mt-1.5 text-[10px] text-brand font-mono uppercase tracking-wider font-semibold">
                          ● Active now
                        </div>
                      )}
                    </div>

                    {canClose && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.threadId);
                        }}
                        className="p-1.5 -m-1.5 rounded-md text-txt-subtle/60 hover:text-rose-300 hover:bg-rose-500/10 transition-colors shrink-0 cursor-pointer"
                        aria-label={`Close ${title}`}
                        title="Close tab"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
