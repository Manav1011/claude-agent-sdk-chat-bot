import React, { useEffect, useRef, useLayoutEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import EmptyState from './EmptyState';
import HumanMessage from './HumanMessage';
import AiMessage from './AiMessage';
import ThinkingMessage from './ThinkingMessage';
import ToolCallMessage from './ToolCallMessage';
import LoadingIndicator from './LoadingIndicator';
import ErrorMessage from './ErrorMessage';

export default function MessagesContainer() {
  const {
    currentThreadId,
    messages,
    sessionCursors,
    isLoadingOlder,
    isSelectingSession,
    isLoadingMessages,
    isStreaming,
    isAiResponding,
    activeStreamContent,
    activeThinkingContent,
    activeSpeechExplanation,
    errorMessage,
    loadOlderMessages,
  } = useChat();

  const containerRef = useRef(null);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const isPaginatingRef = useRef(false);

  const sessionMessages = messages[currentThreadId] || [];

  const cleanMessages = sessionMessages.filter((m) => {
    if (typeof m.content !== 'string') return true;
    if (m.content.startsWith('Stop hook feedback:')) return false;
    if (m.content.startsWith('[structured-output-enforce]')) return false;
    if (m.content.includes('You MUST call the StructuredOutput tool')) return false;
    return true;
  });

  // Handle scroll for older messages pagination
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;

    if (
      !isSelectingSession &&
      el.scrollTop <= 60 &&
      el.scrollHeight > el.clientHeight + 100 &&
      currentThreadId &&
      sessionCursors[currentThreadId] &&
      !isLoadingOlder[currentThreadId]
    ) {
      isPaginatingRef.current = true;
      prevScrollHeightRef.current = el.scrollHeight;
      prevScrollTopRef.current = el.scrollTop;
      loadOlderMessages(currentThreadId);
    }
  };

  // Restore scroll position after pagination or scroll to bottom on new message / streaming
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (isPaginatingRef.current) {
      const heightDiff = el.scrollHeight - prevScrollHeightRef.current;
      el.scrollTop = heightDiff + prevScrollTopRef.current;
      isPaginatingRef.current = false;
    } else if (!isSelectingSession) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [
    cleanMessages.length,
    activeStreamContent,
    activeThinkingContent,
    isAiResponding,
    isSelectingSession,
  ]);

  const hasMessages =
    cleanMessages.length > 0 ||
    Boolean(activeStreamContent) ||
    Boolean(activeThinkingContent) ||
    isAiResponding;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5 pb-32 sm:pb-36 space-y-4 w-full min-w-0"
    >
      {isLoadingOlder[currentThreadId] && (
        <div className="w-full flex items-center justify-center py-2 text-txt-subtle text-xs gap-2 shrink-0">
          <svg className="w-3.5 h-3.5 animate-spin text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Loading older messages...</span>
        </div>
      )}

      {!hasMessages && !isLoadingMessages && <EmptyState />}

      {cleanMessages.map((msg, index) => {
        const key = `msg-${index}-${msg.type}`;
        if (msg.type === 'human') {
          return <HumanMessage key={key} content={msg.content} />;
        }
        if (msg.type === 'ai') {
          return (
            <AiMessage
              key={key}
              content={msg.content}
              speechExplanation={msg.speech_explanation}
              usage={msg.usage}
              messageId={`msg-${currentThreadId}-${index}`}
            />
          );
        }
        if (msg.type === 'thinking') {
          return <ThinkingMessage key={key} content={msg.content} />;
        }
        if (msg.type === 'tool' || msg.type === 'tool_result') {
          return <ToolCallMessage key={key} tool={msg} />;
        }
        return null;
      })}

      {/* Streaming Thinking Delta */}
      {activeThinkingContent && (
        <ThinkingMessage content={activeThinkingContent} defaultOpen={true} />
      )}

      {/* Streaming AI Text Delta */}
      {activeStreamContent && (
        <AiMessage
          content={activeStreamContent}
          speechExplanation={activeSpeechExplanation}
          messageId={`active-stream-${currentThreadId}`}
        />
      )}

      {/* Loading Indicator */}
      {(isAiResponding || isLoadingMessages) && <LoadingIndicator />}

      {/* Error Banner */}
      <ErrorMessage message={errorMessage} />
    </div>
  );
}
