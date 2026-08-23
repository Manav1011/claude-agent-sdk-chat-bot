import React from 'react';
import { useChat } from '../../context/ChatContext';

export default function ProjectsHeader({ onToggleAddForm }) {
  const { expandAllProjects, collapseAllProjects } = useChat();

  return (
    <div className="px-3 pt-3 pb-1.5 flex items-center justify-between text-[11px] font-semibold text-txt-subtle uppercase tracking-wider">
      <div className="flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5 text-txt-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span>Projects</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={expandAllProjects}
          title="Expand all projects"
          className="p-1 rounded hover:bg-dark-elevated hover:text-white text-txt-subtle transition-colors flex items-center justify-center cursor-pointer"
          aria-label="Expand all"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={collapseAllProjects}
          title="Collapse all projects"
          className="p-1 rounded hover:bg-dark-elevated hover:text-white text-txt-subtle transition-colors flex items-center justify-center cursor-pointer"
          aria-label="Collapse all"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onToggleAddForm}
          title="Add project by path"
          className="px-2 py-0.5 rounded-md bg-dark-elevated hover:bg-dark-border text-txt-subtle hover:text-white transition-colors flex items-center gap-1 text-[10px] normal-case font-medium border border-dark-border ml-0.5 cursor-pointer"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          <span>Add</span>
        </button>
      </div>
    </div>
  );
}
