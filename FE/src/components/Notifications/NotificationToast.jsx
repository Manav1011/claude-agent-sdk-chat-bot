import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function NotificationToast() {
  const { notifications } = useChat();

  if (!notifications || notifications.length === 0) return null;

  const colors = {
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    error: 'bg-red-500/10 text-red-400 border-red-500/30',
    info: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`pointer-events-auto px-4 py-2 rounded-lg text-xs font-mono border ${
            colors[n.type] || colors.info
          } shadow-lg animate-msg`}
        >
          {n.message}
        </div>
      ))}
    </div>
  );
}
