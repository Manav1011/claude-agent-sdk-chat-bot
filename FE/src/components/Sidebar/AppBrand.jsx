import React from 'react';

export default function AppBrand() {
  return (
    <div className="p-3 border-b border-dark-border flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand to-amber-600 flex items-center justify-center shadow-glow text-dark-bg font-bold">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div>
          <span className="font-semibold text-xs text-white">Explainer Bot</span>
          <span className="text-[9px] text-txt-subtle block font-mono">Workspace Studio</span>
        </div>
      </div>
    </div>
  );
}
