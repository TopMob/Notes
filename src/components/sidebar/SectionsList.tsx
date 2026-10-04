import React, { useState, useRef, useCallback } from 'react';
import { Plus, MoreVertical, Trash2, Edit2, Check } from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { Section, SECTION_COLORS } from '../../types/notebook';
import { PopoverMenu } from '../common/PopoverMenu';

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
  const [menu, setMenu] = useState<{ sectionId: string; anchor: HTMLElement } | null>(null);
  const renameCancelledRef = useRef(false);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleStartRename = (section: Section) => {
    renameCancelledRef.current = false;
    setEditingSectionId(section.id);
    setEditingTitle(section.title);
    setMenu(null);
  };

  const handleFinishRename = async () => {
    const id = editingSectionId;
    const title = editingTitle.trim();
    const cancelled = renameCancelledRef.current;
    renameCancelledRef.current = false;
    setEditingSectionId(null);
    if (id && title && !cancelled) {
      await renameSection(id, title);
    }
  };

  const menuSection = menu ? sections.find((s) => s.id === menu.sectionId) : undefined;

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
          const isMenuOpen = menu?.sectionId === section.id;

          return (
            <div
              key={section.id}
              className={`section-item ${isActive ? 'active' : ''} ${isMenuOpen ? 'menu-open' : ''} ${isEditing ? 'editing' : ''}`}
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
                    e.stopPropagation();
                    if (e.key === 'Enter') handleFinishRename();
                    if (e.key === 'Escape') {
                      renameCancelledRef.current = true;
                      setEditingSectionId(null);
                    }
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  maxLength={60}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="item-title" title={section.title}>{section.title}</span>
              )}

              {/* Меню действий с разделом */}
              {!isEditing && (
                <div
                  className="item-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="item-more-btn"
                    onClick={(e) => {
                      const anchor = e.currentTarget;
                      setMenu(isMenuOpen ? null : { sectionId: section.id, anchor });
                    }}
                    title="Параметры раздела"
                  >
                    <MoreVertical size={13} />
                  </button>

                  {isMenuOpen && menuSection && (
                    <PopoverMenu
                      anchorEl={menu!.anchor}
                      onClose={closeMenu}
                      width={224}
                      className="section-actions-dropdown"
                    >
                      <button
                        className="dropdown-item"
                        onClick={() => handleStartRename(menuSection)}
                      >
                        <Edit2 size={13} />
                        <span>Переименовать</span>
                      </button>

                      <div className="section-color-selector">
                        <span className="color-selector-label">Цвет вкладки</span>
                        <div className="color-picker-row">
                          {SECTION_COLORS.map((col) => {
                            const isCurrent =
                              menuSection.color.toLowerCase() === col.toLowerCase();
                            return (
                              <button
                                key={col}
                                type="button"
                                className={`mini-color-dot ${isCurrent ? 'active' : ''}`}
                                style={{ backgroundColor: col }}
                                onClick={async () => {
                                  await setSectionColor(menuSection.id, col);
                                  setMenu(null);
                                }}
                                title={`Выбрать цвет ${col}`}
                              >
                                {isCurrent && <Check size={11} color="#fff" strokeWidth={3} />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {sections.length > 1 && (
                        <button
                          className="dropdown-item danger"
                          onClick={() => {
                            setMenu(null);
                            openDeleteConfirm('section', menuSection.id, menuSection.title);
                          }}
                        >
                          <Trash2 size={13} />
                          <span>Удалить в корзину</span>
                        </button>
                      )}
                    </PopoverMenu>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
