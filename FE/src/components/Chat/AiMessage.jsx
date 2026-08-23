import React, { useMemo } from 'react';
import { renderMarkdown } from '../../utils/markdown';
import SpeechPlayer from './SpeechPlayer';

export default function AiMessage({ content, speechExplanation, usage, messageId }) {
  const htmlContent = useMemo(() => renderMarkdown(content || ''), [content]);

  return (
    <div className="animate-msg w-full max-w-3xl lg:max-w-4xl mx-auto min-w-0">
      <div className="mb-4 w-full min-w-0 max-w-full">
        <div
          className="prose-dark ai-content-body min-w-0 max-w-full overflow-hidden break-words px-1 py-1"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
        {speechExplanation && (
          <SpeechPlayer speechText={speechExplanation} messageId={messageId} />
        )}
        {usage && (
          <div className="mt-2 pt-1.5 border-t border-dark-border/40 flex items-center gap-3 font-mono text-[10px] text-txt-subtle flex-wrap">
            <span title="Input tokens">
              in: <strong className="text-txt-muted">{usage.input_tokens || 0}</strong>
            </span>
            <span title="Output tokens">
              out: <strong className="text-txt-muted">{usage.output_tokens || 0}</strong>
            </span>
            <span title="Total tokens">
              total: <strong className="text-brand">{usage.total_tokens || 0}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
