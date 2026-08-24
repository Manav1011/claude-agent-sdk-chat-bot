import React, { useState, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/atom-one-dark.css';

// Interactive Code Block with Language Badge & 1-Click Copy
function CodeBlock({ node, inline, className, children, ...props }) {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const rawCode = String(children).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  if (!inline && (match || rawCode.includes('\n'))) {
    return (
      <div className="my-3 rounded-xl border border-dark-border/80 bg-[#121318] overflow-hidden shadow-md max-w-full">
        {/* Code Header Bar */}
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-dark-elevated/70 border-b border-dark-border/60 text-xs font-mono select-none">
          <span className="text-[11px] font-semibold text-brand tracking-wide uppercase">
            {language || 'code'}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-txt-subtle hover:text-white bg-dark-surface/60 hover:bg-dark-border transition-colors cursor-pointer"
            title="Copy code to clipboard"
          >
            {copied ? (
              <>
                <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-emerald-400 font-medium">Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3 text-txt-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Highlighted Code Container */}
        <pre className="p-3.5 overflow-x-auto text-[12px] sm:text-[13px] font-mono leading-relaxed bg-[#121318] text-txt-main">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  }

  return (
    <code
      className="bg-dark-elevated text-brand font-mono text-[11px] sm:text-[12px] px-1.5 py-0.5 rounded border border-dark-border/60 inline-block align-baseline max-w-full break-normal"
      {...props}
    >
      {children}
    </code>
  );
}

// Markdown Renderer Component with Custom Element Mappings
function MarkdownRenderer({ content }) {
  if (!content) return null;

  return (
    <div className="prose-dark w-full max-w-full overflow-hidden text-xs sm:text-sm leading-relaxed text-txt-main">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: CodeBlock,
          p: ({ children }) => <p className="mb-2.5 last:mb-0 leading-relaxed break-words">{children}</p>,
          h1: ({ children }) => <h1 className="text-lg sm:text-xl font-bold text-white mt-4 mb-2 border-b border-dark-border/40 pb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base sm:text-lg font-semibold text-white mt-3.5 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm sm:text-base font-semibold text-white mt-3 mb-1">{children}</h3>,
          h4: ({ children }) => <h4 className="text-xs sm:text-sm font-semibold text-white mt-2.5 mb-1">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1 text-txt-main">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-txt-main">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-brand/60 pl-3.5 my-2.5 italic text-txt-muted bg-dark-surface/30 py-1.5 rounded-r-lg">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-dark-border/80 shadow-md max-w-full">
              <table className="w-full min-w-max text-left text-xs border-collapse divide-y divide-dark-border/60">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-dark-elevated text-txt-main font-semibold select-none">{children}</thead>,
          th: ({ children }) => <th className="px-3.5 py-2.5 text-xs font-semibold text-white whitespace-nowrap bg-dark-elevated/90 border-b border-dark-border/70">{children}</th>,
          td: ({ children }) => <td className="px-3.5 py-2.5 text-xs text-txt-main border-b border-dark-border/40 last:border-b-0 leading-relaxed min-w-[110px]">{children}</td>,
          tr: ({ children }) => <tr className="even:bg-dark-surface/30 hover:bg-dark-elevated/30 transition-colors">{children}</tr>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline underline-offset-2 font-medium"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-dark-border/60" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownRenderer);
