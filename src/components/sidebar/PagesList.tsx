import React, { useState, useRef, useCallback } from 'react';
import { Plus, MoreVertical, Trash2, Edit2 } from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { Page } from '../../types/notebook';
import { PopoverMenu } from '../common/PopoverMenu';

export const PagesList: React.FC = () => {
  const {
    pages,
    activePage,
    selectPage,
    addPage,
    renamePage,
  } = useNotebookStore();

  const { openDeleteConfirm } = useUiStore();

  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [menu, setMenu] = useState<{ pageId: string; anchor: HTMLElement } | null>(null);
  const renameCancelledRef = useRef(false);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleAddPage = async () => {
    await addPage();
  };

  const handleStartRename = (page: Page) => {
    renameCancelledRef.current = false;
    setEditingPageId(page.id);
    setEditingTitle(page.title);
    setMenu(null);
  };

  const handleFinishRename = async () => {
    const id = editingPageId;
    const title = editingTitle.trim();
    const cancelled = renameCancelledRef.current;
    renameCancelledRef.current = false;
    setEditingPageId(null);
    if (id && title && !cancelled) {
      await renamePage(id, title);
    }
  };

  const menuPage = menu ? pages.find((p) => p.id === menu.pageId) : undefined;

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
          const isMenuOpen = menu?.pageId === page.id;

          return (
            <div
              key={page.id}
              className={`page-item ${isActive ? 'active' : ''} ${isMenuOpen ? 'menu-open' : ''} ${isEditing ? 'editing' : ''}`}
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
                    e.stopPropagation();
                    if (e.key === 'Enter') handleFinishRename();
                    if (e.key === 'Escape') {
                      renameCancelledRef.current = true;
                      setEditingPageId(null);
                    }
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  maxLength={120}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="item-title" title={page.title}>{page.title}</span>
              )}

              {/* Меню действий */}
              {!isEditing && (
                <div
                  className="item-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="item-more-btn"
                    onClick={(e) => {
                      const anchor = e.currentTarget;
                      setMenu(isMenuOpen ? null : { pageId: page.id, anchor });
                    }}
                    title="Параметры страницы"
                  >
                    <MoreVertical size={13} />
                  </button>

                  {isMenuOpen && menuPage && (
                    <PopoverMenu anchorEl={menu!.anchor} onClose={closeMenu} width={208}>
                      <button
                        className="dropdown-item"
                        onClick={() => handleStartRename(menuPage)}
                      >
                        <Edit2 size={13} />
                        <span>Переименовать</span>
                      </button>
                      {pages.length > 1 && (
                        <button
                          className="dropdown-item danger"
                          onClick={() => {
                            setMenu(null);
                            openDeleteConfirm('page', menuPage.id, menuPage.title);
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
