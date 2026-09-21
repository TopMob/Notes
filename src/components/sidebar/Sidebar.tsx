import React, { useState, useRef, useEffect } from 'react';
import {
  Library,
  ChevronDown,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Check,
  BookOpen,
} from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { SectionsList } from './SectionsList';
import { PagesList } from './PagesList';

export const Sidebar: React.FC = () => {
  const { notebooks, activeNotebook, selectNotebook, addNotebook } = useNotebookStore();
  const { isSidebarOpen, toggleSidebar, setSearchOpen } = useUiStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
        setIsCreating(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
        setIsCreating(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  const handleCreateNotebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await addNotebook(newTitle.trim());
    setNewTitle('');
    setIsCreating(false);
    setIsMenuOpen(false);
  };

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
          {activeNotebook?.title || 'Мой блокнот'}
        </div>
      </aside>
    );
  }

  return (
    <aside className="app-sidebar">
      {/* Шапка сайдбара */}
      <div className="sidebar-header">
        <div className="sidebar-header-left" ref={menuRef}>
          <button
            className={`notebook-badge-btn ${isMenuOpen ? 'active' : ''}`}
            onClick={() => {
              setIsMenuOpen(!isMenuOpen);
              setIsCreating(false);
            }}
            title="Блокноты: переключить или создать"
          >
            <Library size={16} className="onenote-purple" />
            <span className="sidebar-notebook-title">
              {activeNotebook?.title || 'Мой блокнот'}
            </span>
            <ChevronDown size={13} className={`chevron ${isMenuOpen ? 'open' : ''}`} />
          </button>

          {/* Выпадающее меню блокнотов */}
          {isMenuOpen && (
            <div className="notebook-dropdown-menu">
              <div className="notebook-dropdown-header">
                <span>Блокноты</span>
              </div>
              <div className="notebook-dropdown-list">
                {notebooks.map((nb) => {
                  const isActive = activeNotebook?.id === nb.id;
                  return (
                    <button
                      key={nb.id}
                      type="button"
                      className={`notebook-dropdown-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        selectNotebook(nb);
                        setIsMenuOpen(false);
                      }}
                    >
                      <BookOpen size={15} className="notebook-item-icon" />
                      <span className="notebook-item-title">{nb.title}</span>
                      {isActive && <Check size={14} className="notebook-item-check" />}
                    </button>
                  );
                })}
              </div>

              <div className="notebook-dropdown-divider" />

              {isCreating ? (
                <form onSubmit={handleCreateNotebook} className="notebook-create-form">
                  <input
                    ref={inputRef}
                    type="text"
                    className="notebook-create-input"
                    placeholder="Название блокнота..."
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    maxLength={50}
                  />
                  <div className="notebook-create-actions">
                    <button
                      type="button"
                      className="btn-text-sm"
                      onClick={() => {
                        setIsCreating(false);
                        setNewTitle('');
                      }}
                    >
                      Отмена
                    </button>
                    <button
                      type="submit"
                      className="btn-primary-sm"
                      disabled={!newTitle.trim()}
                    >
                      Создать
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="notebook-add-btn"
                  onClick={() => setIsCreating(true)}
                >
                  <Plus size={15} />
                  <span>Создать блокнот</span>
                </button>
              )}
            </div>
          )}
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
