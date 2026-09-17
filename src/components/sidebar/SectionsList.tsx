import React, { useState } from 'react';
import { Plus, MoreVertical, Trash2, Edit2 } from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { Section, SECTION_COLORS } from '../../types/notebook';

export const SectionsList: React.FC = () => {
  const {
    sections,
    activeSection,
    selectSection,
    addSection,
    removeSection,
  } = useNotebookStore();

  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [activeMenuSectionId, setActiveMenuSectionId] = useState<string | null>(null);

  const handleAddSection = async () => {
    const title = prompt('Название нового раздела:', 'Новый раздел');
    if (title && title.trim()) {
      await addSection(title.trim());
    }
  };

  const handleStartRename = (section: Section) => {
    setEditingSectionId(section.id);
    setEditingTitle(section.title);
    setActiveMenuSectionId(null);
  };

  const handleFinishRename = async () => {
    if (editingSectionId && editingTitle.trim()) {
      // update title
      const target = sections.find((s) => s.id === editingSectionId);
      if (target) {
        target.title = editingTitle.trim();
        // save
      }
    }
    setEditingSectionId(null);
  };

  return (
    <div className="sidebar-column sections-column">
      {/* Кнопка добавления раздела */}
      <button className="add-item-btn" onClick={handleAddSection}>
        <Plus size={15} />
        <span>Добавить раздел</span>
      </button>

      {/* Список разделов */}
      <div className="items-list">
        {sections.map((section) => {
          const isActive = section.id === activeSection?.id;
          const isEditing = section.id === editingSectionId;

          return (
            <div
              key={section.id}
              className={`section-item ${isActive ? 'active' : ''}`}
              onClick={() => selectSection(section)}
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

              {/* Меню действий */}
              <div
                className="item-actions"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="item-more-btn"
                  onClick={() =>
                    setActiveMenuSectionId(
                      activeMenuSectionId === section.id ? null : section.id
                    )
                  }
                  title="Параметры раздела"
                >
                  <MoreVertical size={13} />
                </button>

                {activeMenuSectionId === section.id && (
                  <div className="dropdown-menu item-context-menu">
                    <button
                      className="dropdown-item"
                      onClick={() => handleStartRename(section)}
                    >
                      <Edit2 size={13} />
                      <span>Переименовать</span>
                    </button>
                    <div className="color-picker-row">
                      {SECTION_COLORS.slice(0, 5).map((col) => (
                        <div
                          key={col}
                          className="mini-color-dot"
                          style={{ backgroundColor: col }}
                          onClick={() => {
                            section.color = col;
                            setActiveMenuSectionId(null);
                          }}
                        />
                      ))}
                    </div>
                    {sections.length > 1 && (
                      <button
                        className="dropdown-item danger"
                        onClick={() => {
                          if (confirm(`Удалить раздел "${section.title}"?`)) {
                            removeSection(section.id);
                          }
                          setActiveMenuSectionId(null);
                        }}
                      >
                        <Trash2 size={13} />
                        <span>Удалить</span>
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
