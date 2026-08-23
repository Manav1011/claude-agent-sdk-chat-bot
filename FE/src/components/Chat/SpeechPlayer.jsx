import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';

export default function SpeechPlayer({ speechText, messageId }) {
  const { speechState, playSpeechExplanation, cycleSpeechRate } = useChat();
  const [showScript, setShowScript] = useState(false);

  const isCurrentPlaying = speechState.isPlaying && speechState.activeId === messageId;

  return (
    <div className="mt-2.5 w-full">
      <div className="speech-player-widget p-2 rounded-xl bg-dark-elevated/60 border border-dark-border/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => playSpeechExplanation(speechText, messageId)}
            className={`speech-play-btn flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-white text-xs font-medium transition-colors shrink-0 cursor-pointer ${
              isCurrentPlaying
                ? 'bg-brand shadow-glow'
                : 'bg-brand hover:bg-brand-hover shadow-sm'
            }`}
          >
            {isCurrentPlaying ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span>Playing</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="speech-btn-label">Listen Explanation</span>
              </>
            )}
          </button>
          <span className="speech-status text-[11px] text-txt-subtle font-mono truncate">
            {isCurrentPlaying ? 'Audio playing...' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => cycleSpeechRate(messageId, speechText)}
            className="speech-speed-btn px-1.5 py-0.5 rounded-md bg-dark-surface text-txt-subtle hover:text-white font-mono text-[10px] transition-colors cursor-pointer"
            title="Playback speed"
          >
            {speechState.rate}x
          </button>
          <button
            type="button"
            onClick={() => setShowScript(!showScript)}
            className="speech-script-toggle text-[11px] text-txt-subtle hover:text-white px-2 py-0.5 rounded hover:bg-dark-surface transition-colors cursor-pointer"
            title="Toggle transcript"
          >
            Script
          </button>
        </div>
      </div>
      {showScript && (
        <div className="speech-script-view mt-1.5 p-2.5 rounded-xl bg-dark-bg/60 border border-dark-border/40 text-xs text-txt-muted leading-relaxed font-sans whitespace-pre-wrap">
          {speechText}
        </div>
      )}
    </div>
  );
}
