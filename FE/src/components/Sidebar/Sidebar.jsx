import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import AppBrand from './AppBrand';
import ProjectsHeader from './ProjectsHeader';
import AddProjectForm from './AddProjectForm';
import ProjectItem from './ProjectItem';

export default function Sidebar() {
  const { projects, isMobileSidebarOpen, setIsMobileSidebarOpen } = useChat();
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);

  return (
    <>
      {/* Mobile Sidebar Backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm transition-opacity ${
          isMobileSidebarOpen ? 'block' : 'hidden'
        }`}
        onClick={() => setIsMobileSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-dark-surface/95 backdrop-blur-md border-r border-dark-border flex flex-col shrink-0 transition-transform duration-300 ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 lg:static`}
      >
        <AppBrand />

        <ProjectsHeader onToggleAddForm={() => setIsAddFormOpen(!isAddFormOpen)} />

        <AddProjectForm isOpen={isAddFormOpen} onClose={() => setIsAddFormOpen(false)} />

        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1.5">
          {projects.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-txt-subtle border border-dashed border-dark-border rounded-xl my-2">
              No projects yet — add one to get started
            </div>
          ) : (
            projects.map((project) => <ProjectItem key={project.id} project={project} />)
          )}
        </div>
      </aside>
    </>
  );
}
