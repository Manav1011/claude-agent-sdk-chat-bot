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
      {/* Mobile tap-to-close layer — invisible, no dim, no blur.
          Sidebar itself is solid (bg-dark-surface) so nothing is "behind" it dim. */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={
          // Mobile: full-height fixed drawer; desktop: static column in flex flow.
          // Width is driven entirely by isSidebarOpen — single source of truth.
          'flex flex-col shrink-0 h-full bg-dark-surface border-r border-dark-border transition-all duration-300 ease-in-out '
          + 'lg:bg-dark-surface/40 lg:backdrop-blur-md '
          + 'lg:static fixed inset-y-0 left-0 z-40 '
          + (isSidebarOpen
              ? 'w-72 lg:w-72 translate-x-0'
              : 'w-72 -translate-x-full lg:w-0 lg:translate-x-0 overflow-hidden lg:border-r-0')
        }
      >
        <ProjectsHeader onToggleAddForm={() => setIsAddFormOpen(!isAddFormOpen)} />
        <AddProjectForm isOpen={isAddFormOpen} onClose={() => setIsAddFormOpen(false)} />
        <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-2 scrollbar-thin min-w-0">
          {projects.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-txt-subtle border border-dashed border-dark-border/80 rounded-xl my-2 mx-1">
              <div className="font-medium text-txt-muted mb-1">No projects yet</div>
              <div>Add a project to get started.</div>
            </div>
          ) : (
            projects.map((project) => <ProjectItem key={project.id} project={project} />)
          )}
        </div>
      </aside>
    </>
  );
}
