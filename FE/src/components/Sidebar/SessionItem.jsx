import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function SessionItem({ session, projectId }) {
  const { currentThreadId, selectSession, deleteSession } = useChat();

  const isCurrentSession = session.thread_id === currentThreadId;
  const rawTitle = session.first_message && session.first_message !== session.thread_id
    ? session.first_message
    : 'New conversation';
  const truncatedTitle = rawTitle.length > 38 ? rawTitle.slice(0, 38) + '...' : rawTitle;

  const handleClick = (e) => {
    if (e.target.closest('.delete-session-btn')) return;
    selectSession(session.thread_id, projectId, rawTitle);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    deleteSession(session.thread_id, projectId);
  };

  return (
    <div
      onClick={handleClick}
      className={`session-item group px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150 flex items-center justify-between gap-1.5 ${
        isCurrentSession
          ? 'bg-brand/15 text-white font-medium border border-brand/40 shadow-sm'
          : 'hover:bg-dark-elevated/70 text-txt-muted hover:text-white border border-transparent'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <svg
          className={`w-3 h-3 shrink-0 ${isCurrentSession ? 'text-brand' : 'text-txt-subtle'}`}
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
        <span className="text-[11px] truncate flex-1 leading-snug" title={rawTitle}>
          {truncatedTitle}
        </span>
      </div>

      <button
        type="button"
        onClick={handleDelete}
        className="delete-session-btn opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-txt-subtle transition-opacity shrink-0 cursor-pointer rounded hover:bg-dark-bg/60"
        title="Delete conversation"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
