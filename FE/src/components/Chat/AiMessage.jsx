import React, { memo } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import SpeechPlayer from './SpeechPlayer';

function AiMessage({ content, speechExplanation, messageId }) {
  return (
    <div className="w-full max-w-3xl lg:max-w-4xl mx-auto min-w-0">
      <div className="mb-4 w-full min-w-0 max-w-full">
        <MarkdownRenderer content={content} />
        {speechExplanation && (
          <SpeechPlayer speechText={speechExplanation} messageId={messageId} />
        )}
      </div>
    </div>
  );
}

export default memo(AiMessage);
