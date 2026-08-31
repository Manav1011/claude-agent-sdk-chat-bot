import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import { isMobileView } from '../../utils/helpers';
import ContextUsagePill from './ContextUsagePill';
import QuickVoiceButton from './QuickVoiceButton';

// Convert a File to a base64 dict that matches the SDK image-block format
// (`{type: "image", source: {type: "base64", media_type, data}}`).
// FileReader.readAsDataURL returns "data:<media>;base64,<data>" — split it.
function fileToBase64Image(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = result.indexOf(',');
      const mediaType = result.slice(5, result.indexOf(';'));
      const data = result.slice(comma + 1);
      resolve({ data, media_type: mediaType });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function ChatInput() {
  const { isStreaming, sendMessage, stopStream, replyQuote, clearReplyQuote, settingSources, skillsList, skillsMode, permissionMode, currentCommands, currentThreadId, rebuilding } = useChat();
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  // ponytail: slash-command palette. visible when input starts with `/` and
  // has no whitespace yet (we don't autocomplete across words). selectedIndex
  // resets to 0 every time the query changes — the user always starts at the top.
  const [paletteSelected, setPaletteSelected] = useState(0);
  // ponytail: ref map for command rows, so ↑/↓ can scroll the highlighted row
  // into view. The popover is max-h-64 (≈8 visible rows) but there are ~91
  // commands, so without this keyboard nav silently loses the user past row 8.
  const buttonRefs = useRef({});
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-resize textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 192) + 'px';
  }, [inputText]);

  // Focus on mount or after stream ends (desktop only to prevent mobile keyboard popups)
  useEffect(() => {
    if (!isStreaming && textareaRef.current && !isMobileView()) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  // Pick/paste/drop images — keep the File locally, base64-encode at send time.
  // (Server-side /api/upload no longer needed for the streaming path: SDK image blocks
  // are sent inline, model sees the image without reading from disk.)
  const handleUploadFiles = async (filesToUpload) => {
    const validImageFiles = Array.from(filesToUpload).filter((f) => f.type.startsWith('image/'));
    if (validImageFiles.length === 0) return;

    const newAttachments = validImageFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items || [];
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      handleUploadFiles(imageFiles);
    }
  };

  const removeAttachment = (idToRemove) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === idToRemove);
      if (target && target.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.id !== idToRemove);
    });
  };

  const hasText = inputText.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  // ponytail: derive palette visibility + filtered list from inputText.
  // currentCommands is the per-session command list from ChatContext (Task 3);
  // it's [] until the BE broadcasts commands_available, so the palette is
  // silently hidden until then.
  const paletteMatch = inputText.match(/^\/(\S*)$/);
  const paletteOpen = Boolean(paletteMatch) && (currentCommands || []).length > 0;
  const paletteQuery = paletteMatch ? paletteMatch[1].toLowerCase() : '';
  const filteredCommands = paletteOpen
    ? (currentCommands || []).filter(
        (c) =>
          c.name.toLowerCase().includes(paletteQuery) ||
          (c.description || '').toLowerCase().includes(paletteQuery)
      )
    : [];
  const isRebuilding = Boolean(currentThreadId && rebuilding[currentThreadId]);
  // ponytail: clamp selectedIndex when the filter result shrinks (e.g. user
  // backspaces). Without this, arrow keys would land on a phantom row.
  const safeSelected = filteredCommands.length === 0
    ? 0
    : Math.min(paletteSelected, filteredCommands.length - 1);
  const hasQuote = Boolean(replyQuote);
  const canSend = hasText || hasAttachments || hasQuote;

  const handleSend = async () => {
    if (isStreaming) {
      stopStream();
      return;
    }
    if (!canSend) return;

    const text = inputText.trim();
    // If a quote is attached, append it as a markdown blockquote. Each line
    // of the quote is prefixed so multi-line selections render as a single
    // blockquote rather than breaking the block.
    const finalText = replyQuote
      ? (text ? `${text}\n\n> ${replyQuote.replace(/\n/g, '\n> ')}` : `> ${replyQuote.replace(/\n/g, '\n> ')}`)
      : text;
    // Read each attached File as base64 inline image blocks. Backend passes these
    // straight to the SDK as `{type: "image", source: {type: "base64", ...}}`.
    const imageData = await Promise.all(
      attachments.map((a) => fileToBase64Image(a.file))
    );

    setInputText('');
    setAttachments([]);
    clearReplyQuote();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    // ponytail: skillsMode='all' is the SDK's "all" sentinel; otherwise pass the
    // user-curated list. null means "use SDK defaults" (current BE behavior).
    const skillsForSend = skillsMode === 'all' ? 'all' : (skillsList || null);
    sendMessage(finalText, [], imageData, {
      settingSources,
      skills: skillsForSend,
      permissionMode,
    });
  };

  // ponytail: reset palette selection whenever the query changes so the user
  // always starts at the top of the (possibly narrower) filtered list.
  useEffect(() => {
    setPaletteSelected(0);
  }, [paletteQuery]);
  // ponytail: keep the highlighted row in view as the user keyboard-navigates.
  // `block: 'nearest'` is a no-op if the row is already visible, so this is
  // cheap. Guarded on paletteOpen so we don't run scrollIntoView on a hidden
  // listbox when no session has commands yet.
  useEffect(() => {
    if (!paletteOpen) return;
    const cmd = filteredCommands[safeSelected];
    if (cmd) buttonRefs.current[cmd.name]?.scrollIntoView({ block: 'nearest' });
  }, [safeSelected, paletteOpen, filteredCommands]);

  const selectPaletteCommand = (cmd) => {
    if (!cmd) return;
    // ponytail: insert "/<name> " so the user can keep typing arguments.
    // argumentHint (e.g. "(file path)") is not auto-inserted — it's a hint
    // shown in the palette, not literal text. Trailing space matches the
    // user-typed pattern (every command in their prompts ends with a space
    // before its arg, or no arg at all).
    setInputText(`/${cmd.name} `);
    setPaletteSelected(0);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (paletteOpen && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPaletteSelected((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPaletteSelected((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectPaletteCommand(filteredCommands[safeSelected]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // ponytail: Esc strips the leading `/` so the palette closes. The
        // remaining query text is kept — the user can keep typing without
        // re-typing the slash. Next keystroke re-evaluates paletteOpen.
        setInputText(inputText.replace(/^\/(\S*)$/, '$1'));
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isMobileView()) {
        return; // On mobile, enter is a newline
      }
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none bg-gradient-to-t from-dark-bg via-dark-bg/95 to-transparent pt-6 pb-[max(0.65rem,env(safe-area-inset-bottom))] px-3 sm:pb-3.5 sm:px-4">
      <div className="w-full max-w-2xl lg:max-w-3xl mx-auto min-w-0">
        {/* Smart Capsule Card */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer?.files) {
              handleUploadFiles(e.dataTransfer.files);
            }
          }}
          className={`pointer-events-auto relative rounded-2xl bg-dark-surface/95 backdrop-blur-2xl border transition-all duration-200 p-2 sm:p-2.5 flex flex-col gap-1.5 shadow-2xl ${
            isDragging
              ? 'border-brand ring-2 ring-brand/30 bg-dark-elevated'
              : 'border-dark-border focus-within:border-brand/60 focus-within:shadow-[0_0_25px_rgba(249,115,22,0.12)]'
          }`}
        >
          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Pending Uploads Thumbnail Tray */}
          {attachments.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 px-1 border-b border-dark-border/40">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="relative group/thumb shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden border border-dark-border/80 bg-dark-bg"
                >
                  <img
                    src={att.previewUrl}
                    alt="Upload thumbnail"
                    className="w-full h-full object-cover select-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="absolute top-0.5 right-0.5 bg-black/70 hover:bg-rose-600 text-white rounded-full p-0.5 opacity-0 group-hover/thumb:opacity-100 transition-opacity cursor-pointer"
                    title="Remove image"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Reply Quote Chip */}
          {replyQuote && (
            <div className="flex items-start gap-2 py-1 px-2 rounded-lg bg-brand/10 border border-brand/30 border-l-2 border-l-brand">
              <svg className="w-3.5 h-3.5 text-brand mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4"
                />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-medium text-brand uppercase tracking-wide leading-none mb-1">
                  Replying to
                </div>
                <div className="text-[11px] sm:text-xs text-txt-main leading-snug line-clamp-2 break-words">
                  {replyQuote}
                </div>
              </div>
              <button
                type="button"
                onClick={clearReplyQuote}
                title="Remove quote"
                className="p-1 rounded hover:bg-dark-bg/60 text-txt-muted hover:text-white transition-colors cursor-pointer shrink-0"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Rebuild indicator — shown while a settings change is reinitializing
              the active session's SDK client. Clears on the next commands_available
              broadcast (handled in ChatContext) or after the 6s safety timeout. */}
          {isRebuilding && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand/10 border border-brand/30 text-[11px] text-txt-muted"
            >
              <svg
                className="w-3 h-3 animate-spin text-brand"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="42 20" />
              </svg>
              <span>Reinitializing session…</span>
            </div>
          )}
          {/* Slash command palette — pops above the textarea when input starts with / */}
          {paletteOpen && (
            <div
              role="listbox"
              aria-label="Slash commands"
              className="z-30 max-h-64 overflow-y-auto bg-dark-surface border border-dark-border rounded-xl shadow-2xl py-1"
            >
              {filteredCommands.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-txt-subtle italic">
                  No matching commands
                </div>
              ) : (
                filteredCommands.map((cmd, idx) => (
                  <button
                    key={cmd.name}
                    type="button"
                    role="option"
                    aria-selected={idx === safeSelected}
                    ref={(el) => {
                      // ponytail: store/clear so unmounted buttons don't leak.
                      if (el) buttonRefs.current[cmd.name] = el;
                      else delete buttonRefs.current[cmd.name];
                    }}
                    onMouseDown={(e) => {
                      // ponytail: mousedown (not click) so the textarea doesn't
                      // lose focus before the state update lands.
                      e.preventDefault();
                      selectPaletteCommand(cmd);
                    }}
                    onMouseEnter={() => setPaletteSelected(idx)}
                    className={`w-full text-left px-2.5 py-1.5 flex items-baseline gap-2 transition-colors cursor-pointer ${
                      idx === safeSelected ? 'bg-brand/15 text-white' : 'text-txt-main hover:bg-dark-elevated'
                    }`}
                  >
                    <span className="font-mono text-xs text-brand shrink-0">/{cmd.name}</span>
                    {cmd.argumentHint ? (
                      <span className="font-mono text-[10px] text-txt-subtle shrink-0">{cmd.argumentHint}</span>
                    ) : null}
                    <span className="text-[11px] text-txt-muted line-clamp-1 flex-1 min-w-0">
                      {cmd.description}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={attachments.length > 0 ? "Add a message about these images..." : "Type a message or prompt..."}
            className="w-full bg-transparent text-xs sm:text-sm text-txt-main placeholder-txt-subtle focus:outline-none resize-none max-h-48 font-sans leading-relaxed block overflow-y-auto min-h-[26px] px-1.5 py-1"
          />

          {/* Bottom Toolbar */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-dark-border/40">
            {/* Left: Plus Attachment Button, Context Usage Pill & Quick Voice Mode Pill */}
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach images (or paste from clipboard)"
                className="h-8 w-8 rounded-lg bg-dark-elevated hover:bg-dark-border border border-dark-border text-txt-muted hover:text-white transition-colors flex items-center justify-center cursor-pointer shrink-0"
              >
                <svg className="w-3.5 h-3.5 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <ContextUsagePill />
              <QuickVoiceButton />
            </div>

            {/* Right: Send / Stop Action Button */}
            {isStreaming ? (
              <button
                type="button"
                onClick={() => stopStream()}
                title="Stop generation"
                className="bg-rose-500 hover:bg-rose-600 text-white h-8 w-8 sm:h-8 sm:w-8 rounded-lg flex items-center justify-center transition-all duration-150 shadow-glow active:scale-95 shrink-0 cursor-pointer"
              >
                <svg className="w-3 h-3 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                title="Send message"
                className="bg-brand hover:bg-brand-hover text-white h-8 w-8 sm:h-8 sm:w-8 rounded-lg flex items-center justify-center transition-all duration-150 disabled:opacity-25 disabled:hover:bg-brand shadow-sm active:scale-95 shrink-0 cursor-pointer"
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
