import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function QuickVoiceButton() {
  const { speechExplanation, setSpeechExplanation, showNotification } = useChat();

  const toggleVoice = () => {
    const nextVal = !speechExplanation;
    setSpeechExplanation(nextVal);
    showNotification(
      nextVal
        ? 'Speech Explanation voice mode enabled'
        : 'Speech Explanation voice mode disabled',
      'info'
    );
  };

  return (
    <button
      type="button"
      onClick={toggleVoice}
      title="Toggle spoken explanations for AI responses"
      // ponytail: icon-only on mobile, full pill on desktop. The "Voice On/Off"
      // label was ~80px wide which crowded the input toolbar at 430px.
      className={`flex items-center justify-center gap-1 h-7 w-7 sm:w-auto sm:h-auto sm:px-2 sm:py-0.5 rounded-lg text-[11px] font-sans transition-all border shrink-0 cursor-pointer ${
        speechExplanation
          ? 'bg-brand/15 text-brand border-brand/40 hover:bg-brand/25 shadow-glow'
          : 'bg-dark-elevated/40 text-txt-subtle border-dark-border/40 hover:text-txt-muted'
      }`}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
        />
      </svg>
      <span className="hidden sm:inline">{speechExplanation ? 'Voice On' : 'Voice Off'}</span>
    </button>
  );
}
