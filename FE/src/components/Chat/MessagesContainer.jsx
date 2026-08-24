import React, { useEffect, useRef, useLayoutEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import EmptyState from './EmptyState';
import HumanMessage from './HumanMessage';
import AiMessage from './AiMessage';
import ThinkingMessage from './ThinkingMessage';
import ToolCallMessage from './ToolCallMessage';
import LoadingIndicator from './LoadingIndicator';
import ErrorMessage from './ErrorMessage';
import PermissionPrompt from './PermissionPrompt';

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
    pendingPermissions,
    loadOlderMessages,
    setPreviewModalImage,
  } = useChat();

  const containerRef = useRef(null);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const isPaginatingRef = useRef(false);
  const userScrolledUpRef = useRef(false);
  const prevMessagesCountRef = useRef(0);

  useEffect(() => {
    userScrolledUpRef.current = false;
  }, [currentThreadId]);

  const sessionMessages = messages[currentThreadId] || [];

  const cleanMessages = sessionMessages.filter((m) => {
    if (typeof m.content !== 'string') return true;
    if (m.content.startsWith('Stop hook feedback:')) return false;
    if (m.content.startsWith('[structured-output-enforce]')) return false;
    if (m.content.includes('You MUST call the StructuredOutput tool')) return false;
    return true;
  });

  // Handle scroll for older messages pagination and user scroll tracking
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 120;

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

  const activePermissions = pendingPermissions.filter(
    (req) => !req.session_id || !currentThreadId || req.session_id === currentThreadId
  );

  // Restore scroll position after pagination or scroll to bottom on new message / streaming / permissions
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (isPaginatingRef.current) {
      const heightDiff = el.scrollHeight - prevScrollHeightRef.current;
      el.scrollTop = heightDiff + prevScrollTopRef.current;
      isPaginatingRef.current = false;
    } else if (!isSelectingSession) {
      if (cleanMessages.length > prevMessagesCountRef.current) {
        const lastMsg = cleanMessages[cleanMessages.length - 1];
        if (lastMsg?.type === 'human') {
          userScrolledUpRef.current = false;
        }
      }
      prevMessagesCountRef.current = cleanMessages.length;

      if (!userScrolledUpRef.current) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
  }, [
    cleanMessages.length,
    activeStreamContent,
    activeThinkingContent,
    isAiResponding,
    isSelectingSession,
    activePermissions.length,
  ]);

  const hasMessages =
    cleanMessages.length > 0 ||
    Boolean(activeStreamContent) ||
    Boolean(activeThinkingContent) ||
    isAiResponding ||
    activePermissions.length > 0;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 sm:p-5 pb-28 sm:pb-36 space-y-3 sm:space-y-4 w-full min-w-0"
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

      {isLoadingMessages && (
        <div className="h-full flex flex-col items-center justify-center text-center my-auto py-16 w-full animate-msg">
          <div className="w-10 h-10 rounded-2xl bg-dark-elevated border border-dark-border flex items-center justify-center mb-3 text-brand shadow-sm">
            <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
          <span className="text-xs text-txt-muted font-medium">Loading conversation...</span>
        </div>
      )}

      {!hasMessages && !isLoadingMessages && <EmptyState />}

      {!isLoadingMessages && cleanMessages.map((msg, index) => {
        const key = `msg-${index}-${msg.type}`;
        if (msg.type === 'human') {
          return (
            <HumanMessage
              key={key}
              content={msg.content}
              images={msg.images}
              onPreviewImage={setPreviewModalImage}
            />
          );
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

      {/* Pending Permission / Question Prompts (scoped to current active session) */}
      {activePermissions.map((req) => (
        <PermissionPrompt key={req.request_id} request={req} />
      ))}

      {/* Loading Indicator (during live agent stream, hidden when awaiting permission in current session) */}
      {isAiResponding && activePermissions.length === 0 && <LoadingIndicator />}

      {/* Error Banner */}
      <ErrorMessage message={errorMessage} />
    </div>
  );
}
