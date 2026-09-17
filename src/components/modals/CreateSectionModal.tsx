import React, { useState, useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useNotebookStore } from '../../store/useNotebookStore';
import { SECTION_COLORS } from '../../types/notebook';

export const CreateSectionModal: React.FC = () => {
  const { isCreateSectionOpen, setCreateSectionOpen } = useUiStore();
  const { addSection } = useNotebookStore();

  const [title, setTitle] = useState('Новый раздел');
  const [selectedColor, setSelectedColor] = useState(SECTION_COLORS[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreateSectionOpen) {
      setTitle('Новый раздел');
      // Случайный или первый цвет
      const randomColor = SECTION_COLORS[Math.floor(Math.random() * SECTION_COLORS.length)];
      setSelectedColor(randomColor);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isCreateSectionOpen]);

  if (!isCreateSectionOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanTitle = title.trim() || 'Новый раздел';
    await addSection(cleanTitle, selectedColor);
    setCreateSectionOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setCreateSectionOpen(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setCreateSectionOpen(false)}>
      <div
        className="modal-content create-section-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h3>Создать новый раздел</h3>
          <button
            className="modal-close-btn"
            onClick={() => setCreateSectionOpen(false)}
            title="Закрыть"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label htmlFor="section-title-input" className="form-label">
              Название раздела
            </label>
            <input
              id="section-title-input"
              ref={inputRef}
              type="text"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Введите название раздела"
              maxLength={40}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Цвет вкладки</label>
            <div className="color-palette-grid">
              {SECTION_COLORS.map((col) => {
                const isSelected = selectedColor.toLowerCase() === col.toLowerCase();
                return (
                  <button
                    key={col}
                    type="button"
                    className={`palette-color-swatch ${isSelected ? 'selected' : ''}`}
                    style={{ backgroundColor: col }}
                    onClick={() => setSelectedColor(col)}
                    title={col}
                  >
                    {isSelected && <Check size={14} color="#fff" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreateSectionOpen(false)}
            >
              Отмена
            </button>
            <button type="submit" className="btn btn-primary">
              Создать раздел
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
