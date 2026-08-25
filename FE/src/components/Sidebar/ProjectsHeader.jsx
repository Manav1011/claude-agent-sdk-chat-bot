import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function ProjectsHeader({ onToggleAddForm }) {
  const { projects, expandAllProjects, collapseAllProjects } = useChat();

  return (
    <div className="px-3 pt-3 pb-2 flex items-center justify-between text-[11px] font-semibold text-txt-subtle border-b border-dark-border/60">
      <div className="flex items-center gap-1.5">
        <span className="uppercase tracking-wider text-[10px] text-txt-subtle/80">Workspaces</span>
        <span className="text-[10px] font-mono text-txt-subtle/70 bg-dark-elevated px-1.5 py-0.5 rounded-full">
          {projects.length}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={expandAllProjects}
          title="Expand all workspaces"
          className="p-1 rounded-md hover:bg-dark-elevated hover:text-white text-txt-subtle transition-colors flex items-center justify-center cursor-pointer"
          aria-label="Expand all"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={collapseAllProjects}
          title="Collapse all workspaces"
          className="p-1 rounded-md hover:bg-dark-elevated hover:text-white text-txt-subtle transition-colors flex items-center justify-center cursor-pointer"
          aria-label="Collapse all"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onToggleAddForm}
          title="Add workspace directory"
          className="ml-1 px-2 py-0.5 rounded-md bg-brand/15 hover:bg-brand/25 text-brand hover:text-white transition-colors flex items-center gap-1 text-[10px] font-semibold cursor-pointer"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
          </svg>
          <span>Add</span>
        </button>
      </div>
    </div>
  );
}
