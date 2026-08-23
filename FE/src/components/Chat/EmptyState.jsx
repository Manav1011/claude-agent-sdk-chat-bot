import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function EmptyState() {
  const { sendMessage } = useChat();

  return (
    <div className="h-full flex flex-col items-center justify-center text-center my-auto py-10 w-full max-w-3xl lg:max-w-4xl mx-auto">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand/20 to-amber-500/10 border border-brand/30 flex items-center justify-center mb-4 shadow-glow">
        <svg className="w-6 h-6 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>
      <h2 className="text-base sm:text-lg font-semibold text-white mb-1.5">
        What would you like to explore?
      </h2>
      <p className="text-txt-muted text-xs sm:text-sm max-w-md mb-6 leading-relaxed">
        Ask questions, run automation workflows, or explore spoken AI explanations.
      </p>

      {/* Prompt Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-md">
        <button
          type="button"
          onClick={() => sendMessage('What skills do you have?')}
          className="prompt-chip text-left p-3 rounded-xl bg-dark-surface hover:bg-dark-elevated border border-dark-border hover:border-brand/30 transition-all duration-200 group cursor-pointer"
        >
          <div className="font-medium text-xs text-white group-hover:text-brand mb-0.5">
            What skills do you have?
          </div>
          <div className="text-[11px] text-txt-subtle truncate">List all installed capabilities</div>
        </button>
        <button
          type="button"
          onClick={() => sendMessage('Explain Machine Learning')}
          className="prompt-chip text-left p-3 rounded-xl bg-dark-surface hover:bg-dark-elevated border border-dark-border hover:border-brand/30 transition-all duration-200 group cursor-pointer"
        >
          <div className="font-medium text-xs text-white group-hover:text-brand mb-0.5">
            Explain Machine Learning
          </div>
          <div className="text-[11px] text-txt-subtle truncate">Get a clear explanation with voice audio</div>
        </button>
      </div>
    </div>
  );
}
