import React from 'react';
import {
  Library,
  ChevronDown,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { SectionsList } from './SectionsList';
import { PagesList } from './PagesList';

export const Sidebar: React.FC = () => {
  const { activeNotebook } = useNotebookStore();
  const { isSidebarOpen, toggleSidebar, setSearchOpen } = useUiStore();

  if (!isSidebarOpen) {
    return (
      <aside className="sidebar-collapsed">
        <button
          className="sidebar-toggle-btn"
          onClick={toggleSidebar}
          title="Развернуть боковую панель (разделы и страницы)"
        >
          <PanelLeftOpen size={18} />
        </button>
        <button
          className="sidebar-icon-shortcut"
          onClick={() => setSearchOpen(true)}
          title="Поиск по заметкам"
        >
          <Search size={16} />
        </button>
        <div className="vertical-notebook-name">
          {activeNotebook?.title || 'колледж'}
        </div>
      </aside>
    );
  }

  return (
    <aside className="app-sidebar">
      {/* Шапка сайдбара */}
      <div className="sidebar-header">
        <div className="sidebar-header-left">
          <button className="notebook-badge-btn" title="Текущий блокнот">
            <Library size={16} className="onenote-purple" />
            <span className="sidebar-notebook-title">
              {activeNotebook?.title || 'колледж'}
            </span>
            <ChevronDown size={13} className="chevron" />
          </button>
        </div>

        <div className="sidebar-header-actions">
          <button
            className="sidebar-action-btn"
            onClick={() => setSearchOpen(true)}
            title="Поиск заметок"
          >
            <Search size={16} />
          </button>
          <button
            className="sidebar-action-btn"
            onClick={toggleSidebar}
            title="Свернуть боковую панель"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>

      {/* Две колонки: Разделы и Страницы */}
      <div className="sidebar-columns-container">
        <SectionsList />
        <PagesList />
      </div>
    </aside>
  );
};
