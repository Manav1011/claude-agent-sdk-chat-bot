import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import ProjectsHeader from './ProjectsHeader';
import AddProjectForm from './AddProjectForm';
import ProjectItem from './ProjectItem';

export default function Sidebar() {
  const { projects, isSidebarOpen, setIsSidebarOpen } = useChat();
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);

  return (
    <>
      {/* Mobile Sidebar Backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm transition-opacity ${
          isSidebarOpen ? 'block' : 'hidden'
        }`}
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 bg-dark-surface/95 backdrop-blur-md border-r border-dark-border flex flex-col shrink-0 transition-all duration-300 ease-in-out select-none ${
          isSidebarOpen
            ? 'w-72 translate-x-0 lg:static'
            : 'w-72 -translate-x-full lg:static lg:w-0 lg:border-r-0 lg:overflow-hidden'
        }`}
      >
        <div className="w-72 flex flex-col h-full pt-1">
          <ProjectsHeader onToggleAddForm={() => setIsAddFormOpen(!isAddFormOpen)} />

          <AddProjectForm isOpen={isAddFormOpen} onClose={() => setIsAddFormOpen(false)} />

          <div className="flex-1 overflow-y-auto px-2.5 py-1 space-y-2">
            {projects.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-txt-subtle border border-dashed border-dark-border/80 rounded-xl my-2">
                No projects yet — add one to get started
              </div>
            ) : (
              projects.map((project) => <ProjectItem key={project.id} project={project} />)
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
