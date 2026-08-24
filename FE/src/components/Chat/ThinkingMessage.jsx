import React, { memo } from 'react';

function ThinkingMessage({ content, defaultOpen = false }) {
  return (
    <div className="w-full max-w-3xl lg:max-w-4xl mx-auto min-w-0 mb-2 sm:mb-3">
      <div className="bg-dark-surface/40 border border-dark-border/60 rounded-xl px-2.5 py-1.5 sm:px-3.5 sm:py-2 text-xs font-mono min-w-0 max-w-full overflow-hidden">
        <details className="group" open={defaultOpen ? true : undefined}>
          <summary className="flex items-center justify-between cursor-pointer text-txt-subtle hover:text-txt-muted select-none">
            <span className="text-[10px] sm:text-[11px] font-sans font-medium text-txt-subtle">Thought Process</span>
            <svg
              className="w-3.5 h-3.5 transition-transform group-open:rotate-180 text-txt-subtle shrink-0 ml-1.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="thinking-body mt-2 pt-2 border-t border-dark-border/40 text-txt-muted whitespace-pre-wrap leading-relaxed text-[11px] break-words overflow-x-auto">
            {content}
          </div>
        </details>
      </div>
    </div>
  );
}

export default memo(ThinkingMessage);
