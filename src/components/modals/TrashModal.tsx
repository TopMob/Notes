import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, RotateCcw, X, Folder, FileText } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useNotebookStore } from '../../store/useNotebookStore';
import { Section, Page } from '../../types/notebook';

export const TrashModal: React.FC = () => {
  const { isTrashOpen, setTrashOpen } = useUiStore();
  const {
    getTrashItems,
    restoreSection,
    permanentDeleteSection,
    restorePage,
    permanentDeletePage,
  } = useNotebookStore();

  const [trashSections, setTrashSections] = useState<Section[]>([]);
  const [trashPages, setTrashPages] = useState<Page[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'sections' | 'pages'>('all');
  const [isLoading, setIsLoading] = useState(false);

  const fetchTrash = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await getTrashItems();
      setTrashSections(items.sections);
      setTrashPages(items.pages);
    } catch (err) {
      console.error('Failed to load trash:', err);
    } finally {
      setIsLoading(false);
    }
  }, [getTrashItems]);

  useEffect(() => {
    if (isTrashOpen) {
      fetchTrash();
    }
  }, [isTrashOpen, fetchTrash]);

  if (!isTrashOpen) return null;

  const handleRestoreSection = async (id: string) => {
    await restoreSection(id);
    await fetchTrash();
  };

  const handlePermanentDeleteSection = async (id: string) => {
    await permanentDeleteSection(id);
    await fetchTrash();
  };

  const handleRestorePage = async (id: string) => {
    await restorePage(id);
    await fetchTrash();
  };

  const handlePermanentDeletePage = async (id: string) => {
    await permanentDeletePage(id);
    await fetchTrash();
  };

  const handleEmptyAll = async () => {
    for (const sec of trashSections) {
      await permanentDeleteSection(sec.id);
    }
    for (const pg of trashPages) {
      await permanentDeletePage(pg.id);
    }
    await fetchTrash();
  };

  const totalCount = trashSections.length + trashPages.length;

  const formatDate = (timestamp?: number | null) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="modal-backdrop" onClick={() => setTrashOpen(false)}>
      <div className="modal-content trash-modal" onClick={(e) => e.stopPropagation()}>
        {/* Шапка модального окна */}
        <div className="modal-header">
          <div className="trash-modal-title-group">
            <Trash2 size={18} className="trash-title-icon" />
            <h3>Корзина</h3>
            {totalCount > 0 && <span className="trash-badge-count">{totalCount}</span>}
          </div>
          <button
            className="modal-close-btn"
            onClick={() => setTrashOpen(false)}
            title="Закрыть"
          >
            <X size={16} />
          </button>
        </div>

        {/* Вкладки и кнопка очистки */}
        <div className="trash-toolbar">
          <div className="trash-tabs">
            <button
              className={`trash-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              Все ({totalCount})
            </button>
            <button
              className={`trash-tab-btn ${activeTab === 'sections' ? 'active' : ''}`}
              onClick={() => setActiveTab('sections')}
            >
              Разделы ({trashSections.length})
            </button>
            <button
              className={`trash-tab-btn ${activeTab === 'pages' ? 'active' : ''}`}
              onClick={() => setActiveTab('pages')}
            >
              Страницы ({trashPages.length})
            </button>
          </div>

          {totalCount > 0 && (
            <button className="btn-empty-trash" onClick={handleEmptyAll}>
              <Trash2 size={13} />
              <span>Очистить корзину</span>
            </button>
          )}
        </div>

        {/* Тело корзины */}
        <div className="modal-body trash-body">
          {isLoading ? (
            <div className="trash-loading">Загрузка удаленных элементов...</div>
          ) : totalCount === 0 ? (
            <div className="trash-empty-state">
              <div className="trash-empty-icon-wrapper">
                <Trash2 size={36} />
              </div>
              <p className="trash-empty-title">Корзина пуста</p>
              <p className="trash-empty-subtitle">
                Удаленные разделы и страницы будут сохраняться здесь. Вы сможете восстановить их в любой момент.
              </p>
            </div>
          ) : (
            <div className="trash-items-list">
              {/* Разделы */}
              {(activeTab === 'all' || activeTab === 'sections') &&
                trashSections.map((sec) => (
                  <div key={sec.id} className="trash-item">
                    <div className="trash-item-info">
                      <div className="trash-item-icon-tag">
                        <Folder size={16} style={{ color: sec.color }} />
                        <span className="trash-type-badge">Раздел</span>
                      </div>
                      <div className="trash-item-details">
                        <span className="trash-item-title">{sec.title}</span>
                        {sec.deletedAt && (
                          <span className="trash-item-date">
                            Удалено: {formatDate(sec.deletedAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="trash-item-actions">
                      <button
                        className="trash-action-btn restore"
                        onClick={() => handleRestoreSection(sec.id)}
                        title="Восстановить раздел"
                      >
                        <RotateCcw size={14} />
                        <span>Восстановить</span>
                      </button>
                      <button
                        className="trash-action-btn permanent-delete"
                        onClick={() => handlePermanentDeleteSection(sec.id)}
                        title="Удалить навсегда"
                      >
                        <Trash2 size={14} />
                        <span>Удалить</span>
                      </button>
                    </div>
                  </div>
                ))}

              {/* Страницы */}
              {(activeTab === 'all' || activeTab === 'pages') &&
                trashPages.map((pg) => (
                  <div key={pg.id} className="trash-item">
                    <div className="trash-item-info">
                      <div className="trash-item-icon-tag">
                        <FileText size={16} className="page-icon" />
                        <span className="trash-type-badge page-badge">Страница</span>
                      </div>
                      <div className="trash-item-details">
                        <span className="trash-item-title">{pg.title}</span>
                        {pg.deletedAt && (
                          <span className="trash-item-date">
                            Удалено: {formatDate(pg.deletedAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="trash-item-actions">
                      <button
                        className="trash-action-btn restore"
                        onClick={() => handleRestorePage(pg.id)}
                        title="Восстановить страницу"
                      >
                        <RotateCcw size={14} />
                        <span>Восстановить</span>
                      </button>
                      <button
                        className="trash-action-btn permanent-delete"
                        onClick={() => handlePermanentDeletePage(pg.id)}
                        title="Удалить навсегда"
                      >
                        <Trash2 size={14} />
                        <span>Удалить</span>
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
