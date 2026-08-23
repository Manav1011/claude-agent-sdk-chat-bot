import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function SessionItem({ session, projectId }) {
  const { currentThreadId, selectSession, deleteSession } = useChat();

  const isCurrentSession = session.thread_id === currentThreadId;
  const rawTitle = session.first_message && session.first_message !== session.thread_id
    ? session.first_message
    : 'New conversation';
  const truncatedTitle = rawTitle.length > 40 ? rawTitle.slice(0, 40) + '...' : rawTitle;

  const handleClick = (e) => {
    if (e.target.closest('.delete-session-btn')) return;
    selectSession(session.thread_id, projectId);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    deleteSession(session.thread_id, projectId);
  };

  return (
    <div
      onClick={handleClick}
      className={`session-item group px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150 flex items-center justify-between ${
        isCurrentSession
          ? 'bg-dark-elevated border border-brand/40 text-white font-medium shadow-sm'
          : 'hover:bg-dark-elevated/50 text-txt-muted hover:text-white border border-transparent'
      }`}
    >
      <span className="text-[11px] truncate flex-1 leading-snug">{truncatedTitle}</span>
      <button
        type="button"
        onClick={handleDelete}
        className="delete-session-btn opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-txt-subtle transition-opacity ml-1 shrink-0 cursor-pointer"
        title="Delete session"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
