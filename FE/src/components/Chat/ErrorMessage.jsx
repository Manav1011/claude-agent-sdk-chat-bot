import React from 'react';

export default function ErrorMessage({ message }) {
  if (!message) return null;
  return (
    <div className="animate-msg flex justify-start mb-4 w-full max-w-3xl lg:max-w-4xl mx-auto">
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 max-w-[85%] text-xs text-red-400">
        <span className="font-semibold block mb-1">Execution Error</span>
        {message}
      </div>
    </div>
  );
}
