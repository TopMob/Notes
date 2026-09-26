import React, { useState, useEffect, useRef } from 'react';
import { Plus, MoreVertical, Trash2, Edit2, Link, Check } from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { Page } from '../../types/notebook';
import { formatPageUrl, titleToSlug } from '../../utils/slug';

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
  const [activeMenuPageId, setActiveMenuPageId] = useState<string | null>(null);
  const [copiedPageId, setCopiedPageId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Закрытие контекстного меню при клике вне его
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuPageId(null);
      }
    };
    if (activeMenuPageId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeMenuPageId]);

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

  const handleCopyLink = async (page: Page) => {
    const slug = page.slug || titleToSlug(page.title);
    const url = formatPageUrl(slug, true);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPageId(page.id);
      setTimeout(() => setCopiedPageId(null), 2000);
    } catch {
      // fallback
    }
    setActiveMenuPageId(null);
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
          const isMenuOpen = activeMenuPageId === page.id;

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
                    setActiveMenuPageId(isMenuOpen ? null : page.id)
                  }
                  title="Параметры страницы"
                >
                  <MoreVertical size={13} />
                </button>

                {isMenuOpen && (
                  <div ref={menuRef} className="dropdown-menu item-context-menu">
                    <button
                      className="dropdown-item"
                      onClick={() => handleCopyLink(page)}
                    >
                      {copiedPageId === page.id ? (
                        <Check size={13} style={{ color: 'var(--brand-green, #107c41)' }} />
                      ) : (
                        <Link size={13} />
                      )}
                      <span>
                        {copiedPageId === page.id ? 'Ссылка скопирована!' : 'Копировать ссылку'}
                      </span>
                    </button>
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
                          setActiveMenuPageId(null);
                          openDeleteConfirm('page', page.id, page.title);
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
