import React from 'react';

export default function HumanMessage({ content }) {
  return (
    <div className="animate-msg w-full max-w-3xl lg:max-w-4xl mx-auto min-w-0">
      <div className="flex justify-end mb-2.5 min-w-0 max-w-full">
        <div className="bg-dark-elevated/90 text-txt-main text-xs sm:text-sm rounded-xl px-3 py-1.5 max-w-[80%] w-fit break-words whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}
