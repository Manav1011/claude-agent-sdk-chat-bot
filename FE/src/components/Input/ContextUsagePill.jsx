import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function ContextUsagePill() {
  const { contextUsage, setIsContextModalOpen } = useChat();

  if (!contextUsage) return null;

  const pct = contextUsage.percentage || 0;
  let dotClass = 'w-1.5 h-1.5 rounded-full bg-emerald-400';
  if (pct >= 85) {
    dotClass = 'w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse';
  } else if (pct >= 60) {
    dotClass = 'w-1.5 h-1.5 rounded-full bg-amber-400';
  }

  return (
    <button
      type="button"
      onClick={() => setIsContextModalOpen(true)}
      title="View context window breakdown"
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-dark-elevated/70 hover:bg-dark-elevated border border-dark-border/60 hover:border-brand/40 text-[11px] font-mono transition-all group shrink-0 cursor-pointer"
    >
      <span className={dotClass} />
      <span className="text-txt-muted group-hover:text-white font-medium">
        {pct}% context
      </span>
    </button>
  );
}
