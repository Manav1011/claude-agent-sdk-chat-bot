import React from 'react';
import { useChat } from '../../context/ChatContext';

const formatRelative = (msEpoch) => {
  if (!msEpoch) return '';
  const diff = Date.now() - msEpoch;
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'now';
  if (diff < hr) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(msEpoch).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function SessionItem({ session, projectId }) {
  const {
    currentThreadId,
    activeStreams,
    selectSession,
    deleteSession,
  } = useChat();

  const isCurrentSession = session.thread_id === currentThreadId;
  const isLive = Boolean(activeStreams[session.thread_id]?.isStreaming);
  const rawTitle = session.first_message && session.first_message !== session.thread_id
    ? session.first_message
    : 'New conversation';
  const truncatedTitle = rawTitle.length > 40 ? rawTitle.slice(0, 40) + '…' : rawTitle;

  const timeLabel = formatRelative(session.last_modified);
  const fullTimestamp = session.last_modified
    ? new Date(session.last_modified).toLocaleString()
    : rawTitle;

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
      title={fullTimestamp}
      className={`session-item group relative pl-1.5 pr-1.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150 border ${
        isCurrentSession
          ? 'bg-gradient-to-r from-brand/20 via-brand/10 to-transparent text-white border-brand/40 shadow-sm shadow-brand/10'
          : 'hover:bg-white/[0.04] text-txt-muted hover:text-white border-transparent hover:border-white/5'
      }`}
    >
      {/* Active accent bar */}
      <span
        className={`absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-colors ${
          isCurrentSession ? 'bg-brand' : 'bg-transparent group-hover:bg-white/20'
        }`}
        aria-hidden="true"
      />

      <div className="flex items-start gap-1.5 min-w-0">
        {/* Live dot — pulses while this session streams. */}
        <span
          className={`shrink-0 mt-1 w-1.5 h-1.5 rounded-full transition-colors ${
            isLive
              ? 'bg-brand animate-pulse shadow-[0_0_8px_var(--color-brand)]'
              : isCurrentSession
              ? 'bg-brand'
              : 'bg-txt-subtle/30'
          }`}
          aria-hidden="true"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-[11.5px] truncate flex-1 leading-snug font-medium" title={rawTitle}>
              {truncatedTitle}
            </span>
            {timeLabel && (
              <span className={`shrink-0 text-[9.5px] font-mono leading-snug ${
                isCurrentSession ? 'text-brand/80' : 'text-txt-subtle/70'
              }`}>
                {timeLabel}
              </span>
            )}
          </div>
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
    </div>
  );
}
