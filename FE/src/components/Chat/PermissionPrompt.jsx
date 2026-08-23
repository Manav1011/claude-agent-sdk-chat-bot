import React, { useState, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import { formatJson } from '../../utils/helpers';

export default function PermissionPrompt({ request }) {
  const { respondToPermission } = useChat();

  const isAskUserQuestion = request.tool_name === 'AskUserQuestion';
  const questions = request.tool_input?.questions || [];

  // Countdown timer for 5 minutes (300 seconds)
  const [timeLeft, setTimeLeft] = useState(300);
  const [isTimedOut, setIsTimedOut] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setIsTimedOut(true);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // State for AskUserQuestion answers & custom inputs
  const [selectedOptions, setSelectedOptions] = useState(() => {
    const initial = {};
    questions.forEach((q, idx) => {
      const key = q.question || q.header || `q_${idx}`;
      initial[key] = q.multiSelect ? [] : (q.options?.[0]?.label || '');
    });
    return initial;
  });

  const [customTextAnswers, setCustomTextAnswers] = useState(() => {
    const initial = {};
    questions.forEach((q, idx) => {
      const key = q.question || q.header || `q_${idx}`;
      initial[key] = '';
    });
    return initial;
  });

  // Tool Permission Custom State
  const [isEditingInput, setIsEditingInput] = useState(false);
  const [customInputText, setCustomInputText] = useState(() => formatJson(request.tool_input || {}));
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelectOption = (key, val, isMulti) => {
    setSelectedOptions((prev) => {
      if (isMulti) {
        const currentList = Array.isArray(prev[key]) ? prev[key] : [];
        if (currentList.includes(val)) {
          return { ...prev, [key]: currentList.filter((item) => item !== val) };
        } else {
          return { ...prev, [key]: [...currentList, val] };
        }
      } else {
        return { ...prev, [key]: val };
      }
    });
  };

  const handleAllow = async () => {
    if (isTimedOut) return;
    setIsSubmitting(true);
    try {
      if (isAskUserQuestion) {
        // Build final answers object: keys MUST be question text
        const finalAnswers = {};
        questions.forEach((q, idx) => {
          const key = q.question || q.header || `q_${idx}`;
          const answerKey = q.question || key;
          const custom = (customTextAnswers[key] || '').trim();
          const selected = selectedOptions[key];

          if (q.multiSelect) {
            const list = Array.isArray(selected) ? [...selected] : [];
            if (custom && !list.includes(custom)) {
              list.push(custom);
            }
            finalAnswers[answerKey] = list;
          } else {
            finalAnswers[answerKey] = custom || selected || '';
          }
        });

        await respondToPermission(request.request_id, 'allow', { answers: finalAnswers });
      } else {
        let updatedInput = null;
        if (isEditingInput) {
          try {
            updatedInput = JSON.parse(customInputText);
          } catch (e) {
            // Keep as string or fallback
          }
        }
        await respondToPermission(request.request_id, 'allow', {
          updatedInput: updatedInput || undefined,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeny = async () => {
    if (isTimedOut) return;
    setIsSubmitting(true);
    try {
      await respondToPermission(request.request_id, 'deny', {
        message: denyReason.trim() || (isAskUserQuestion ? "I prefer not to answer" : "Permission denied by user"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSuggestionLabel = (sug) => {
    if (typeof sug === 'string') return sug;
    if (typeof sug === 'object' && sug !== null) {
      if (sug.label) return String(sug.label);
      if (sug.title) return String(sug.title);
      if (sug.type === 'addRules') {
        const dest = sug.destination ? ` for this ${sug.destination}` : '';
        const tool = sug.rules?.[0]?.toolName ? ` (${sug.rules[0].toolName})` : '';
        return `Always allow${dest}${tool}`;
      }
      if (sug.behavior) {
        return `Always ${sug.behavior}`;
      }
      if (sug.description) return String(sug.description);
    }
    return 'Accept suggestion';
  };

  const handleSuggestionClick = (sug) => {
    if (isTimedOut) return;
    if (typeof sug === 'string') {
      const lower = sug.toLowerCase();
      if (lower === 'allow') {
        handleAllow();
      } else if (lower.includes('changes') || lower.includes('edit')) {
        setIsEditingInput(true);
      } else if (lower.includes('deny')) {
        setDenyReason(sug);
        handleDeny();
      } else {
        handleAllow();
      }
    } else if (typeof sug === 'object' && sug !== null) {
      if (sug.behavior === 'deny') {
        setDenyReason(sug.description || 'Denied');
        handleDeny();
      } else {
        handleAllow();
      }
    }
  };

  const displayTitle =
    typeof request.title === 'string' && request.title
      ? request.title
      : isAskUserQuestion
      ? 'Question from Assistant'
      : 'Permission Required';

  const displayDescription =
    typeof request.description === 'string' && request.description
      ? request.description
      : typeof request.description === 'object' && request.description !== null
      ? JSON.stringify(request.description)
      : isAskUserQuestion
      ? 'Please select an option or provide a custom answer'
      : 'The assistant requested permission to execute this tool';

  return (
    <div className="animate-msg w-full max-w-3xl lg:max-w-4xl mx-auto my-3 min-w-0">
      <div className="bg-dark-surface/95 border-2 border-brand/50 rounded-2xl p-4 sm:p-5 shadow-2xl shadow-brand/10 space-y-4 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-dark-border/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-brand/20 border border-brand/40 flex items-center justify-center text-brand shrink-0">
              {isAskUserQuestion ? (
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-xs sm:text-sm text-white">
                  {displayTitle}
                </span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-brand/15 text-brand border border-brand/30 font-medium">
                  {String(request.tool_name || '')}
                </span>
              </div>
              <span className="text-[11px] text-txt-subtle block mt-0.5">
                {displayDescription}
              </span>
            </div>
          </div>

          {/* Timeout Countdown Badge */}
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 flex items-center gap-1.5 ${isTimedOut ? 'text-red-400 bg-red-500/10 border-red-500/30' : 'text-amber-400/90 bg-amber-500/10 border-amber-500/20'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isTimedOut ? 'bg-red-400' : 'bg-amber-400 animate-pulse'}`} />
              {isTimedOut ? 'Timed out' : `${formatTimer(timeLeft)}`}
            </span>
          </div>
        </div>

        {/* Content Body */}
        {isAskUserQuestion ? (
          <div className="space-y-4">
            {questions.map((q, qIdx) => {
              const key = q.question || q.header || `q_${qIdx}`;
              const currentSelected = selectedOptions[key];
              const customVal = customTextAnswers[key] || '';

              return (
                <div key={qIdx} className="p-3.5 rounded-xl bg-dark-elevated/40 border border-dark-border/60 space-y-3">
                  <div className="font-medium text-xs text-white">
                    {q.header ? <strong className="text-brand mr-1.5">{q.header}:</strong> : null}
                    {q.question}
                  </div>

                  {/* Options List */}
                  {q.options && q.options.length > 0 && (
                    <div className="space-y-1.5 pt-0.5">
                      {q.options.map((opt, optIdx) => {
                        const isSelected = q.multiSelect
                          ? Array.isArray(currentSelected) && currentSelected.includes(opt.label)
                          : currentSelected === opt.label && !customVal;

                        return (
                          <div
                            key={optIdx}
                            onClick={() => {
                              if (!q.multiSelect) {
                                setCustomTextAnswers((prev) => ({ ...prev, [key]: '' }));
                              }
                              handleSelectOption(key, opt.label, q.multiSelect);
                            }}
                            className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-start gap-2.5 ${
                              isSelected
                                ? 'bg-brand/15 border-brand/60 text-white shadow-sm'
                                : 'bg-dark-bg/60 border-dark-border/60 hover:bg-dark-surface text-txt-muted hover:text-white'
                            }`}
                          >
                            <div
                              className={`mt-0.5 w-4 h-4 rounded-${q.multiSelect ? 'md' : 'full'} border flex items-center justify-center shrink-0 ${
                                isSelected ? 'border-brand bg-brand text-white' : 'border-dark-border bg-dark-surface'
                              }`}
                            >
                              {isSelected && (
                                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium">{opt.label}</div>
                              {opt.description && (
                                <div className="text-[11px] text-txt-subtle mt-0.5">{opt.description}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Custom Text Input Fallback */}
                  <div className="pt-1">
                    <label className="text-[10px] text-txt-subtle uppercase tracking-wider block mb-1 font-mono">
                      Custom Answer / Write-in:
                    </label>
                    <input
                      type="text"
                      value={customVal}
                      onChange={(e) =>
                        setCustomTextAnswers((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      placeholder={q.multiSelect ? "Add custom answer to selection..." : "Or type your own answer here..."}
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-txt-subtle focus:outline-none focus:border-brand/50 font-sans"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-[11px] text-txt-muted">
              <span>
                Target tool: <strong className="text-white font-mono">{request.tool_name}</strong>
              </span>
              <button
                type="button"
                onClick={() => setIsEditingInput(!isEditingInput)}
                className="text-[11px] text-brand hover:underline font-medium cursor-pointer"
              >
                {isEditingInput ? 'View Original' : 'Modify Arguments'}
              </button>
            </div>

            {isEditingInput ? (
              <textarea
                value={customInputText}
                onChange={(e) => setCustomInputText(e.target.value)}
                rows={5}
                className="w-full bg-[#0a0b0e] p-3 rounded-xl border border-brand/50 text-emerald-400 text-[11px] font-mono leading-relaxed focus:outline-none"
              />
            ) : (
              <div className="bg-[#0a0b0e] p-3 rounded-xl border border-dark-border/80 overflow-x-auto max-h-48">
                <pre className="text-[11px] text-emerald-400/90 font-mono leading-relaxed whitespace-pre-wrap break-all">
                  {formatJson(request.tool_input || {})}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Suggestions Pills */}
        {request.suggestions && request.suggestions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[10px] text-txt-subtle font-mono uppercase tracking-wider">Suggestions:</span>
            {request.suggestions.map((sug, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSuggestionClick(sug)}
                className="px-2.5 py-1 rounded-md bg-dark-elevated hover:bg-dark-border text-txt-muted hover:text-white border border-dark-border text-[11px] font-mono transition-colors cursor-pointer"
              >
                {getSuggestionLabel(sug)}
              </button>
            ))}
          </div>
        )}

        {/* Optional Deny reason input */}
        {showDenyInput && (
          <div className="pt-2 animate-msg">
            <input
              type="text"
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder="Reason for declining (optional)..."
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-txt-subtle focus:outline-none focus:border-brand/50 font-sans"
            />
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-dark-border/40">
          <div className="text-[10px] text-txt-subtle font-mono">
            {isTimedOut ? 'Auto-denied after 5 minutes timeout' : 'Stream paused waiting for your response'}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!showDenyInput && !isAskUserQuestion && (
              <button
                type="button"
                onClick={() => setShowDenyInput(true)}
                className="text-[11px] text-txt-subtle hover:text-txt-muted underline px-1 cursor-pointer"
              >
                Add reason
              </button>
            )}

            <button
              type="button"
              disabled={isSubmitting || isTimedOut}
              onClick={handleDeny}
              className="px-3.5 py-1.5 rounded-lg bg-dark-elevated hover:bg-red-500/20 text-txt-muted hover:text-red-400 border border-dark-border hover:border-red-500/30 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              Deny
            </button>

            <button
              type="button"
              disabled={isSubmitting || isTimedOut}
              onClick={handleAllow}
              className="px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-medium transition-colors shadow-glow cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>Submitting...</span>
                </>
              ) : (
                <span>{isAskUserQuestion ? 'Submit Answers' : isEditingInput ? 'Allow with Changes' : 'Allow'}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
