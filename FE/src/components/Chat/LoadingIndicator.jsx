import React from 'react';

export default function LoadingIndicator() {
  return (
    <div className="animate-msg flex items-center gap-3 mb-4 w-full max-w-3xl lg:max-w-4xl mx-auto">
      <div className="w-7 h-7 rounded-lg bg-brand/20 border border-brand/30 flex items-center justify-center shrink-0 text-brand">
        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
      <div className="bg-dark-surface border border-dark-border rounded-xl px-4 py-2.5 flex items-center gap-2">
        <span className="flex gap-1 items-center">
          <span className="w-1.5 h-1.5 rounded-full bg-brand pulse-dot" />
          <span className="w-1.5 h-1.5 rounded-full bg-brand pulse-dot" />
          <span className="w-1.5 h-1.5 rounded-full bg-brand pulse-dot" />
        </span>
        <span className="text-xs text-txt-muted font-medium">Agent is processing...</span>
      </div>
    </div>
  );
}
