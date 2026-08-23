import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function ContextModal() {
  const { isContextModalOpen, setIsContextModalOpen, contextUsage } = useChat();

  if (!isContextModalOpen || !contextUsage) return null;

  const max = contextUsage.maxTokens || 180000;
  const INACTIVE = ['Free space', 'Autocompact buffer'];
  const activeCats = (contextUsage.categories || []).filter((c) => !INACTIVE.includes(c.name));
  const inactiveCats = (contextUsage.categories || []).filter((c) => INACTIVE.includes(c.name));

  const totalUsed = activeCats.reduce((s, c) => s + c.tokens, 0);
  const pct = max > 0 ? Math.round((totalUsed / max) * 100) : 0;
  const totalFree = inactiveCats.reduce((s, c) => s + c.tokens, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsContextModalOpen(false);
      }}
    >
      <div className="bg-dark-elevated border border-dark-border rounded-2xl shadow-2xl w-80 max-h-[80vh] overflow-y-auto">
        <div className="p-4 border-b border-dark-border flex items-center justify-between">
          <h3 className="text-sm font-medium text-txt-main">Context Window</h3>
          <button
            type="button"
            onClick={() => setIsContextModalOpen(false)}
            className="text-txt-subtle hover:text-txt-main cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4">
          <div className="text-center mb-4">
            <div className="text-2xl font-bold text-brand">{totalUsed.toLocaleString()}</div>
            <div className="text-xs text-txt-subtle">
              of {max.toLocaleString()} tokens ({pct}%)
            </div>
            <div className="w-full h-2 bg-dark-bg rounded-full mt-2 overflow-hidden border border-dark-border/50">
              <div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <table className="w-full text-xs mb-4">
            <thead>
              <tr className="text-txt-subtle border-b border-dark-border/50">
                <th className="text-left py-1 px-2 font-medium">Category</th>
                <th className="text-right py-1 px-2 font-medium">Tokens</th>
                <th className="text-right py-1 px-2 font-medium">%</th>
              </tr>
            </thead>
            <tbody className="text-txt-main">
              {activeCats.map((c, i) => (
                <tr key={i}>
                  <td className="py-1 px-2">{c.name}</td>
                  <td className="py-1 px-2 text-right font-mono">{c.tokens.toLocaleString()}</td>
                  <td className="py-1 px-2 text-right text-txt-subtle">
                    {max > 0 ? Math.round((c.tokens / max) * 100) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-dark-border/50 pt-2">
            <div className="text-xs text-txt-subtle">
              Free space:{' '}
              <strong className="text-txt-main font-mono">{totalFree.toLocaleString()}</strong> tokens
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
