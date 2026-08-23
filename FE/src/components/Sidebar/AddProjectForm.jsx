import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';

export default function AddProjectForm({ isOpen, onClose }) {
  const { addNewProject } = useChat();
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const pathInputRef = useRef(null);

  useEffect(() => {
    if (isOpen && pathInputRef.current) {
      pathInputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const success = await addNewProject(name, path);
    if (success) {
      setPath('');
      setName('');
      onClose();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="mx-3 my-2 p-2.5 bg-dark-elevated/90 border border-brand/40 rounded-xl space-y-2 text-xs animate-msg">
      <div className="font-medium text-[11px] text-white flex items-center justify-between">
        <span>Add Project</span>
        <button
          type="button"
          onClick={onClose}
          className="text-txt-subtle hover:text-white text-sm leading-none cursor-pointer"
        >
          &times;
        </button>
      </div>
      <input
        ref={pathInputRef}
        type="text"
        placeholder="/path/to/project"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full bg-dark-bg border border-dark-border rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono placeholder:text-txt-subtle focus:outline-none focus:border-brand/40"
      />
      <input
        type="text"
        placeholder="Project name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full bg-dark-bg border border-dark-border rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder:text-txt-subtle focus:outline-none focus:border-brand/40"
      />
      <button
        type="button"
        onClick={handleSubmit}
        className="w-full bg-brand hover:bg-brand-hover text-white text-[11px] font-medium py-1.5 rounded-lg transition-colors shadow-glow cursor-pointer"
      >
        Track Project
      </button>
    </div>
  );
}
