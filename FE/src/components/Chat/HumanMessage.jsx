import React, { memo } from 'react';

function HumanMessage({ content, images, onPreviewImage }) {
  const hasImages = Array.isArray(images) && images.length > 0;

  return (
    <div className="animate-msg w-full max-w-3xl lg:max-w-4xl mx-auto min-w-0">
      <div className="flex justify-end mb-2.5 min-w-0 max-w-full">
        <div className="bg-dark-elevated/90 text-txt-main text-xs sm:text-sm rounded-xl px-3 py-2 max-w-[85%] sm:max-w-[75%] w-fit break-words space-y-2">
          {hasImages && (
            <div className={`grid gap-1.5 ${images.length === 1 ? 'grid-cols-1' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
              {images.map((img, idx) => (
                <div
                  key={idx}
                  onClick={() => onPreviewImage?.(img)}
                  className="relative group/img overflow-hidden rounded-lg border border-dark-border/60 bg-dark-bg cursor-pointer aspect-video max-h-48 sm:max-h-56"
                  title="Click to preview"
                >
                  <img
                    src={img}
                    alt="Attachment"
                    className="w-full h-full object-cover transition-transform duration-200 group-hover/img:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                    <svg className="w-5 h-5 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          )}
          {Boolean(content) && <div className="whitespace-pre-wrap leading-relaxed">{content}</div>}
        </div>
      </div>
    </div>
  );
}

export default memo(HumanMessage);
