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
  const { isStreaming, sendMessage, stopStream } = useChat();
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
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
  const canSend = hasText || hasAttachments;

  const handleSend = async () => {
    if (isStreaming) {
      stopStream();
      return;
    }
    if (!canSend) return;

    const text = inputText.trim();
    // Read each attached File as base64 inline image blocks. Backend passes these
    // straight to the SDK as `{type: "image", source: {type: "base64", ...}}`.
    const imageData = await Promise.all(
      attachments.map((a) => fileToBase64Image(a.file))
    );

    setInputText('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    sendMessage(text, [], imageData);
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

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none bg-gradient-to-t from-dark-bg via-dark-bg/95 to-transparent pt-6 pb-[max(0.65rem,env(safe-area-inset-bottom))] px-2.5 sm:pb-3.5 sm:px-4">
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
                className="h-7 w-7 rounded-lg bg-dark-elevated hover:bg-dark-border border border-dark-border text-txt-muted hover:text-white transition-colors flex items-center justify-center cursor-pointer shrink-0"
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
                disabled={!canSend}
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
