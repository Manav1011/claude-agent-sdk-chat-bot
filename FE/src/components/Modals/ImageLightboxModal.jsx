import React, { useEffect } from 'react';
import { useChat } from '../../context/ChatContext';

export default function ImageLightboxModal() {
  const { previewModalImage, setPreviewModalImage } = useChat();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setPreviewModalImage(null);
      }
    };
    if (previewModalImage) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewModalImage, setPreviewModalImage]);

  if (!previewModalImage) return null;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = previewModalImage;
    link.download = `image-attachment-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-6 animate-msg"
      onClick={(e) => {
        if (e.target === e.currentTarget) setPreviewModalImage(null);
      }}
    >
      {/* Top Controls Bar */}
      <div className="w-full max-w-4xl flex items-center justify-between py-2.5 px-4 mb-2 bg-dark-surface/90 border border-dark-border/80 rounded-xl text-xs text-txt-muted shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-2 text-white font-medium">
          <svg className="w-4 h-4 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Image Preview</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Download Button */}
          <button
            type="button"
            onClick={handleDownload}
            className="px-2.5 py-1 rounded-lg bg-dark-elevated hover:bg-dark-border text-txt-muted hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer border border-dark-border text-xs"
            title="Download image"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">Download</span>
          </button>

          {/* Close Button */}
          <button
            type="button"
            onClick={() => setPreviewModalImage(null)}
            className="p-1.5 rounded-lg bg-dark-elevated hover:bg-rose-500/20 hover:text-rose-400 text-txt-subtle transition-colors cursor-pointer border border-dark-border"
            title="Close (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Image Center View */}
      <div className="relative max-w-4xl max-h-[80vh] flex items-center justify-center overflow-hidden rounded-2xl border border-dark-border/80 shadow-2xl bg-dark-bg/60">
        <img
          src={previewModalImage}
          alt="Expanded Preview"
          className="max-w-full max-h-[78vh] object-contain rounded-2xl select-none"
        />
      </div>
    </div>
  );
}
