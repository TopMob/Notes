import React from 'react';
import { Trash2, X, AlertTriangle } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useNotebookStore } from '../../store/useNotebookStore';

export const ConfirmDeleteModal: React.FC = () => {
  const { deleteConfirm, closeDeleteConfirm } = useUiStore();
  const { moveToTrashSection, moveToTrashPage } = useNotebookStore();

  if (!deleteConfirm || !deleteConfirm.isOpen) return null;

  const isSection = deleteConfirm.type === 'section';
  const itemTypeLabel = isSection ? 'раздел' : 'страницу';

  const handleConfirm = async () => {
    if (isSection) {
      await moveToTrashSection(deleteConfirm.id);
    } else {
      await moveToTrashPage(deleteConfirm.id);
    }
    closeDeleteConfirm();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') closeDeleteConfirm();
    if (e.key === 'Enter') handleConfirm();
  };

  return (
    <div className="modal-backdrop" onClick={closeDeleteConfirm}>
      <div
        className="modal-content confirm-delete-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <div className="modal-header">
          <div className="modal-header-title-group">
            <AlertTriangle size={18} className="warning-icon" />
            <h3>Удалить {itemTypeLabel} в корзину?</h3>
          </div>
          <button className="modal-close-btn" onClick={closeDeleteConfirm} title="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <p className="confirm-message">
            Вы действительно хотите переместить {itemTypeLabel}{' '}
            <strong className="confirm-item-title">«{deleteConfirm.title}»</strong> в корзину?
          </p>
          <p className="confirm-hint">
            Вы сможете восстановить этот объект или удалить его навсегда в окне корзины.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={closeDeleteConfirm}>
            Отмена
          </button>
          <button type="button" className="btn btn-danger" onClick={handleConfirm} autoFocus>
            <Trash2 size={14} />
            <span>Переместить в корзину</span>
          </button>
        </div>
      </div>
    </div>
  );
};
