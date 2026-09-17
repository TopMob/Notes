import React, { useState, useEffect, useRef } from 'react';
import { Plus, MoreVertical, Trash2, Edit2, Check } from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { Section, SECTION_COLORS } from '../../types/notebook';

export const SectionsList: React.FC = () => {
  const {
    sections,
    activeSection,
    selectSection,
    renameSection,
    setSectionColor,
  } = useNotebookStore();

  const { setCreateSectionOpen, openDeleteConfirm } = useUiStore();

  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [activeMenuSectionId, setActiveMenuSectionId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Закрытие меню при клике вне его
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuSectionId(null);
      }
    };
    if (activeMenuSectionId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeMenuSectionId]);

  const handleStartRename = (section: Section) => {
    setEditingSectionId(section.id);
    setEditingTitle(section.title);
    setActiveMenuSectionId(null);
  };

  const handleFinishRename = async () => {
    if (editingSectionId && editingTitle.trim()) {
      await renameSection(editingSectionId, editingTitle.trim());
    }
    setEditingSectionId(null);
  };

  return (
    <div className="sidebar-column sections-column">
      {/* Кнопка добавления раздела (открывает кастомное модальное окно) */}
      <button className="add-item-btn" onClick={() => setCreateSectionOpen(true)}>
        <Plus size={15} />
        <span>Добавить раздел</span>
      </button>

      {/* Список разделов */}
      <div className="items-list">
        {sections.map((section) => {
          const isActive = section.id === activeSection?.id;
          const isEditing = section.id === editingSectionId;
          const isMenuOpen = activeMenuSectionId === section.id;

          return (
            <div
              key={section.id}
              className={`section-item ${isActive ? 'active' : ''}`}
              onClick={() => selectSection(section)}
              onDoubleClick={() => handleStartRename(section)}
            >
              {/* Цветной левый маркер раздела (как в OneNote) */}
              <div
                className="section-color-strip"
                style={{ backgroundColor: section.color }}
              />

              {isEditing ? (
                <input
                  type="text"
                  className="rename-input"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename();
                    if (e.key === 'Escape') setEditingSectionId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="item-title">{section.title}</span>
              )}

              {/* Меню действий с разделом */}
              <div
                className="item-actions"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="item-more-btn"
                  onClick={() =>
                    setActiveMenuSectionId(isMenuOpen ? null : section.id)
                  }
                  title="Параметры раздела"
                >
                  <MoreVertical size={13} />
                </button>

                {isMenuOpen && (
                  <div
                    ref={menuRef}
                    className="dropdown-menu item-context-menu section-actions-dropdown"
                  >
                    <button
                      className="dropdown-item"
                      onClick={() => handleStartRename(section)}
                    >
                      <Edit2 size={13} />
                      <span>Переименовать</span>
                    </button>

                    <div className="section-color-selector">
                      <span className="color-selector-label">Цвет вкладки:</span>
                      <div className="color-picker-row">
                        {SECTION_COLORS.map((col) => {
                          const isCurrent =
                            section.color.toLowerCase() === col.toLowerCase();
                          return (
                            <button
                              key={col}
                              type="button"
                              className={`mini-color-dot ${isCurrent ? 'active' : ''}`}
                              style={{ backgroundColor: col }}
                              onClick={async () => {
                                await setSectionColor(section.id, col);
                                setActiveMenuSectionId(null);
                              }}
                              title={`Выбрать цвет ${col}`}
                            >
                              {isCurrent && <Check size={10} color="#fff" strokeWidth={3} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {sections.length > 1 && (
                      <button
                        className="dropdown-item danger"
                        onClick={() => {
                          setActiveMenuSectionId(null);
                          openDeleteConfirm('section', section.id, section.title);
                        }}
                      >
                        <Trash2 size={13} />
                        <span>Удалить в корзину</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
