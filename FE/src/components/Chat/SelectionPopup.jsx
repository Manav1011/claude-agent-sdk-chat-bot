import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useChat } from '../../context/ChatContext';

const MIN_CHARS = 2;
const MAX_CHARS = 4000;

export default function SelectionPopup() {
  const { setReplyQuote } = useChat();
  const [popup, setPopup] = useState(null); // { x, y, text }
  const buttonRef = useRef(null);

  // Hide the popup on any document interaction except our own button.
  useEffect(() => {
    if (!popup) return;
    const onMouseDown = (e) => {
      if (buttonRef.current && buttonRef.current.contains(e.target)) return;
      // The selection is being replaced (e.g. user is starting a new drag) — hide.
      setPopup(null);
    };
    const onScroll = () => setPopup(null);
    const onKey = (e) => {
      if (e.key === 'Escape') setPopup(null);
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [popup]);

  const handleMouseUp = useCallback(() => {
    // Defer to next tick so the browser has finalized the selection.
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setPopup(null);
        return;
      }
      const text = sel.toString();
      if (!text || text.trim().length < MIN_CHARS || text.length > MAX_CHARS) {
        setPopup(null);
        return;
      }
      // Must be inside the messages container, not in the input/sidebar.
      const anchor = sel.anchorNode;
      if (!anchor) {
        setPopup(null);
        return;
      }
      const targetEl = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
      if (!targetEl?.closest?.('[data-messages]')) {
        setPopup(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPopup(null);
        return;
      }
      // Position above the selection, clamped to the viewport.
      const POPUP_W = 92;
      const x = Math.max(
        POPUP_W / 2 + 8,
        Math.min(window.innerWidth - POPUP_W / 2 - 8, rect.left + rect.width / 2)
      );
      const y = Math.max(8, rect.top - 8);
      setPopup({ x, y, text: text.trim() });
    }, 0);
  }, []);

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  if (!popup) return null;

  return (
    <button
      ref={buttonRef}
      type="button"
      onMouseDown={(e) => {
        // mousedown not click — we already captured the selection text; clear it
        // and forward to the input via context.
        e.preventDefault();
        setReplyQuote(popup.text);
        setPopup(null);
        const sel = window.getSelection();
        sel?.removeAllRanges();
      }}
      style={{ left: popup.x, top: popup.y, transform: 'translate(-50%, -100%)' }}
      className="fixed z-50 flex items-center gap-1.5 px-2.5 py-1.5 bg-dark-surface/95 backdrop-blur-md border border-dark-border/80 hover:border-brand/60 rounded-lg shadow-2xl text-xs text-txt-main hover:text-white transition-colors cursor-pointer"
    >
      <svg className="w-3 h-3 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4"
        />
      </svg>
      <span className="font-medium">Reply</span>
    </button>
  );
}
