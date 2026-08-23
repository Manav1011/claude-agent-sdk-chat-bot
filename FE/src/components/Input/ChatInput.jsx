import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import { isMobileView } from '../../utils/helpers';
import ContextUsagePill from './ContextUsagePill';
import QuickVoiceButton from './QuickVoiceButton';

export default function ChatInput() {
  const { isStreaming, sendMessage, stopStream } = useChat();
  const [inputText, setInputText] = useState('');
  const textareaRef = useRef(null);

  // Auto-resize textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 192) + 'px';
  }, [inputText]);

  // Focus on mount or after stream ends
  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const handleSend = () => {
    if (isStreaming) {
      stopStream();
      return;
    }
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    sendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isMobileView()) {
        return; // On mobile, enter is a newline
      }
      e.preventDefault();
      handleSend();
    }
  };

  const hasText = inputText.trim().length > 0;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none bg-gradient-to-t from-dark-bg via-dark-bg/85 to-transparent pt-8 pb-3 px-3 sm:pb-4 sm:px-4">
      <div className="w-full max-w-2xl lg:max-w-3xl mx-auto min-w-0">
        {/* Smart Capsule Card */}
        <div className="pointer-events-auto relative rounded-2xl bg-dark-surface/95 backdrop-blur-2xl border border-dark-border focus-within:border-brand/60 focus-within:shadow-[0_0_25px_rgba(249,115,22,0.12)] shadow-2xl transition-all duration-200 p-2 sm:p-2.5 flex flex-col gap-1.5">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message or prompt..."
            className="w-full bg-transparent text-xs sm:text-sm text-txt-main placeholder-txt-subtle focus:outline-none resize-none max-h-48 font-sans leading-relaxed block overflow-y-auto min-h-[26px] px-1.5 py-1"
          />

          {/* Bottom Toolbar */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-dark-border/40">
            {/* Left: Context Usage Pill & Quick Voice Mode Pill */}
            <div className="flex items-center gap-1.5 min-w-0">
              <ContextUsagePill />
              <QuickVoiceButton />
            </div>

            {/* Right: Send / Stop Action Button */}
            {isStreaming ? (
              <button
                type="button"
                onClick={stopStream}
                title="Stop generation"
                className="bg-rose-500 hover:bg-rose-600 text-white h-7 w-7 sm:h-7.5 sm:w-7.5 rounded-lg flex items-center justify-center transition-all duration-150 shadow-glow active:scale-95 shrink-0 cursor-pointer"
              >
                <svg className="w-3 h-3 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!hasText}
                title="Send message"
                className="bg-brand hover:bg-brand-hover text-white h-7 w-7 sm:h-7.5 sm:w-7.5 rounded-lg flex items-center justify-center transition-all duration-150 disabled:opacity-25 disabled:hover:bg-brand shadow-sm active:scale-95 shrink-0 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
