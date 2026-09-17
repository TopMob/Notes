import React, { useState } from 'react';
import { Plus, MoreVertical, Trash2, Edit2 } from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { Page } from '../../types/notebook';

export const PagesList: React.FC = () => {
  const {
    pages,
    activePage,
    selectPage,
    addPage,
    removePage,
    renamePage,
  } = useNotebookStore();

  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [activeMenuPageId, setActiveMenuPageId] = useState<string | null>(null);

  const handleAddPage = async () => {
    await addPage();
  };

  const handleStartRename = (page: Page) => {
    setEditingPageId(page.id);
    setEditingTitle(page.title);
    setActiveMenuPageId(null);
  };

  const handleFinishRename = async () => {
    if (editingPageId && editingTitle.trim()) {
      await renamePage(editingPageId, editingTitle.trim());
    }
    setEditingPageId(null);
  };

  return (
    <div className="sidebar-column pages-column">
      {/* Кнопка добавления страницы */}
      <button className="add-item-btn" onClick={handleAddPage}>
        <Plus size={15} />
        <span>Добавить страницу</span>
      </button>

      {/* Список страниц */}
      <div className="items-list">
        {pages.map((page) => {
          const isActive = page.id === activePage?.id;
          const isEditing = page.id === editingPageId;

          return (
            <div
              key={page.id}
              className={`page-item ${isActive ? 'active' : ''}`}
              onClick={() => selectPage(page)}
              onDoubleClick={() => handleStartRename(page)}
            >
              {isEditing ? (
                <input
                  type="text"
                  className="rename-input"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename();
                    if (e.key === 'Escape') setEditingPageId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="item-title">{page.title}</span>
              )}

              {/* Меню действий */}
              <div
                className="item-actions"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="item-more-btn"
                  onClick={() =>
                    setActiveMenuPageId(
                      activeMenuPageId === page.id ? null : page.id
                    )
                  }
                  title="Параметры страницы"
                >
                  <MoreVertical size={13} />
                </button>

                {activeMenuPageId === page.id && (
                  <div className="dropdown-menu item-context-menu">
                    <button
                      className="dropdown-item"
                      onClick={() => handleStartRename(page)}
                    >
                      <Edit2 size={13} />
                      <span>Переименовать</span>
                    </button>
                    {pages.length > 1 && (
                      <button
                        className="dropdown-item danger"
                        onClick={() => {
                          if (confirm(`Удалить страницу "${page.title}"?`)) {
                            removePage(page.id);
                          }
                          setActiveMenuPageId(null);
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
