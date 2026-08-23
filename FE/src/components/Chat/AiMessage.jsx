import React, { useMemo, memo } from 'react';
import { renderMarkdown } from '../../utils/markdown';
import SpeechPlayer from './SpeechPlayer';

function AiMessage({ content, speechExplanation, usage, messageId }) {
  const htmlContent = useMemo(() => renderMarkdown(content || ''), [content]);

  return (
    <div className="w-full max-w-3xl lg:max-w-4xl mx-auto min-w-0">
      <div className="mb-4 w-full min-w-0 max-w-full">
        <div
          className="prose-dark ai-content-body min-w-0 max-w-full overflow-hidden break-words px-1 py-1"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
        {speechExplanation && (
          <SpeechPlayer speechText={speechExplanation} messageId={messageId} />
        )}
      </div>
    </div>
  );
}

export default memo(AiMessage);
