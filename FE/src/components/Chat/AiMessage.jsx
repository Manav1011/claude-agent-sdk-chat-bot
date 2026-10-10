import React, { memo } from 'react';
import MarkdownRenderer from './MarkdownRenderer';

function AiMessage({ content }) {
  return (
    <div className="w-full max-w-[65ch] sm:max-w-2xl lg:max-w-4xl mx-auto min-w-0">
      <div className="mb-4 w-full min-w-0 max-w-full">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
}

export default memo(AiMessage);
