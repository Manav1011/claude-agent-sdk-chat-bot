import React, { memo } from 'react';
import { formatJson } from '../../utils/helpers';

function ToolCallMessage({ tool }) {
  const toolName = tool.name || tool.tool_name || 'Tool';
  const inputObj = tool.input || tool.args || null;
  const inputCmd = inputObj?.command ? `$ ${inputObj.command}` : '';
  const inputFilePath = inputObj?.file_path || inputObj?.path || '';
  const inputPattern = inputObj?.pattern || inputObj?.query || '';
  const inputDesc = inputObj?.description || inputCmd || inputFilePath || inputPattern || '';
  const rawOutput = tool.content ?? tool.output ?? tool.result ?? '';
  const outputText = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2);

  return (
    <div className="w-full max-w-3xl lg:max-w-4xl mx-auto min-w-0 my-1.5 sm:my-2">
      <div className="bg-dark-surface/90 hover:bg-dark-surface border border-dark-border/80 hover:border-brand/40 rounded-xl overflow-hidden shadow-sm transition-all min-w-0 max-w-full">
        <details className="group">
          <summary className="flex items-center justify-between px-2.5 py-1.5 sm:px-3.5 sm:py-2 cursor-pointer select-none bg-dark-elevated/40 hover:bg-dark-elevated/80 transition-colors min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden pr-2">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-400" />
                <span className="font-mono text-[10px] sm:text-[11px] font-semibold text-txt-main px-1.5 py-0.5 rounded bg-dark-elevated border border-dark-border">
                  {toolName}
                </span>
              </div>
              <span className="font-mono text-[11px] sm:text-xs text-txt-muted truncate block min-w-0 flex-1">
                {inputCmd || inputDesc || 'Executed tool'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-1">
              <span className="text-[10px] font-mono text-txt-subtle group-open:hidden hidden sm:inline">
                View output
              </span>
              <svg
                className="w-3.5 h-3.5 transition-transform group-open:rotate-180 text-txt-subtle shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </summary>
          <div className="border-t border-dark-border/60 bg-[#0a0b0e] p-3 text-xs font-mono space-y-2.5 overflow-hidden">
            {inputObj && Object.keys(inputObj).length > 0 && (
              <div className="min-w-0 max-w-full overflow-hidden">
                <div className="text-[10px] text-txt-subtle uppercase tracking-wider mb-1 font-mono">
                  Input Parameters
                </div>
                <pre className="text-[11px] text-emerald-400/90 overflow-x-auto bg-dark-surface/80 p-2.5 rounded-lg border border-dark-border/60 leading-relaxed max-h-40 max-w-full whitespace-pre-wrap break-all">
                  {formatJson(inputObj)}
                </pre>
              </div>
            )}
            {outputText && (
              <div className="min-w-0 max-w-full overflow-hidden">
                <div className="text-[10px] text-txt-subtle uppercase tracking-wider mb-1 font-mono">
                  Output
                </div>
                <pre className="text-[11px] text-txt-muted overflow-x-auto bg-dark-surface/80 p-2.5 rounded-lg border border-dark-border/60 leading-relaxed max-h-56 max-w-full whitespace-pre-wrap break-all">
                  {outputText}
                </pre>
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

export default memo(ToolCallMessage);
