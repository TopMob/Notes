import React from 'react';
import {
  X,
  Crosshair,
  CircleDot,
  Eraser,
  Hand,
  Ban,
  Moon,
  Sun,
  Settings,
  Check,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';
import { useUiStore } from '../../store/useUiStore';

export const SettingsModal: React.FC = () => {
  const { isSettingsOpen, setSettingsOpen, theme, setTheme } = useUiStore();
  const {
    penCursorStyle,
    setPenCursorStyle,
    rightClickAction,
    setRightClickAction,
    eraserSize,
    setEraserSize,
  } = useCanvasStore();

  if (!isSettingsOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={20} style={{ color: 'var(--brand-onenote)' }} />
            <h3>Параметры и настройки</h3>
          </div>
          <button
            className="modal-close-btn"
            onClick={() => setSettingsOpen(false)}
            title="Закрыть настройки"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body settings-modal-body">
          {/* Секция 1: Стиль курсора */}
          <div className="settings-section">
            <h4 className="settings-section-title">Стиль курсора рисования</h4>
            <p className="settings-section-desc">
              Выберите отображение указателя мыши при рисовании пером или маркером.
            </p>

            <div className="settings-cards-grid">
              <button
                type="button"
                className={`settings-option-card ${penCursorStyle === 'crosshair' ? 'active' : ''}`}
                onClick={() => setPenCursorStyle('crosshair')}
              >
                <div className="settings-option-icon">
                  <Crosshair size={22} />
                </div>
                <div className="settings-option-info">
                  <div className="settings-option-label">Перекрестие (+)</div>
                  <div className="settings-option-sub">
                    Классический точный крестик для черчения и заметок
                  </div>
                </div>
                {penCursorStyle === 'crosshair' && (
                  <div className="settings-check-badge">
                    <Check size={16} />
                  </div>
                )}
              </button>

              <button
                type="button"
                className={`settings-option-card ${penCursorStyle === 'circle' ? 'active' : ''}`}
                onClick={() => setPenCursorStyle('circle')}
              >
                <div className="settings-option-icon">
                  <CircleDot size={22} />
                </div>
                <div className="settings-option-info">
                  <div className="settings-option-label">Точка / Кружок</div>
                  <div className="settings-option-sub">
                    Точка в центре с кружком по реальной толщине пера
                  </div>
                </div>
                {penCursorStyle === 'circle' && (
                  <div className="settings-check-badge">
                    <Check size={16} />
                  </div>
                )}
              </button>
            </div>
          </div>

          <div className="settings-divider" />

          {/* Секция 2: Действие при зажатии ПКМ */}
          <div className="settings-section">
            <h4 className="settings-section-title">Действие при зажатии правой кнопки мыши (ПКМ)</h4>
            <p className="settings-section-desc">
              Что происходит при зажатии и ведении правой кнопки мыши по холсту.
            </p>

            <div className="settings-cards-grid">
              <button
                type="button"
                className={`settings-option-card ${rightClickAction === 'point-eraser' ? 'active' : ''}`}
                onClick={() => setRightClickAction('point-eraser')}
              >
                <div className="settings-option-icon">
                  <Eraser size={22} />
                </div>
                <div className="settings-option-info">
                  <div className="settings-option-label">
                    Точечный ластик
                    <span className="settings-tag-recommended">По умолчанию</span>
                  </div>
                  <div className="settings-option-sub">
                    Стирает фрагмент штриха непосредственно под курсором
                  </div>
                </div>
                {rightClickAction === 'point-eraser' && (
                  <div className="settings-check-badge">
                    <Check size={16} />
                  </div>
                )}
              </button>

              <button
                type="button"
                className={`settings-option-card ${rightClickAction === 'stroke-eraser' ? 'active' : ''}`}
                onClick={() => setRightClickAction('stroke-eraser')}
              >
                <div className="settings-option-icon">
                  <Eraser size={22} />
                </div>
                <div className="settings-option-info">
                  <div className="settings-option-label">Поштриховой ластик</div>
                  <div className="settings-option-sub">
                    Стирает всю линию целиком при касании
                  </div>
                </div>
                {rightClickAction === 'stroke-eraser' && (
                  <div className="settings-check-badge">
                    <Check size={16} />
                  </div>
                )}
              </button>

              <button
                type="button"
                className={`settings-option-card ${rightClickAction === 'pan' ? 'active' : ''}`}
                onClick={() => setRightClickAction('pan')}
              >
                <div className="settings-option-icon">
                  <Hand size={22} />
                </div>
                <div className="settings-option-info">
                  <div className="settings-option-label">Панорамирование холста</div>
                  <div className="settings-option-sub">
                    Перемещение холста зажатой правой кнопкой мыши
                  </div>
                </div>
                {rightClickAction === 'pan' && (
                  <div className="settings-check-badge">
                    <Check size={16} />
                  </div>
                )}
              </button>

              <button
                type="button"
                className={`settings-option-card ${rightClickAction === 'none' ? 'active' : ''}`}
                onClick={() => setRightClickAction('none')}
              >
                <div className="settings-option-icon">
                  <Ban size={22} />
                </div>
                <div className="settings-option-info">
                  <div className="settings-option-label">Отключено</div>
                  <div className="settings-option-sub">
                    ПКМ не вызывает ластик или панорамирование
                  </div>
                </div>
                {rightClickAction === 'none' && (
                  <div className="settings-check-badge">
                    <Check size={16} />
                  </div>
                )}
              </button>
            </div>

            {/* Настройка размера ластика (для инструмента и ПКМ) */}
            <div style={{ marginTop: '16px', padding: '12px 14px', background: 'var(--bg-hover)', borderRadius: '8px', border: '1px solid var(--hairline)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                  Размер ластика (применяется для инструмента Ластик и для ПКМ):
                </span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--brand-onenote)' }}>
                  {eraserSize} px
                </span>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input
                  type="range"
                  min="6"
                  max="60"
                  step="2"
                  value={eraserSize}
                  onChange={(e) => setEraserSize(Number(e.target.value))}
                  style={{ flex: 1, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[8, 16, 24, 36, 48].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`tool-btn ${eraserSize === s ? 'active' : ''}`}
                      style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '4px' }}
                      onClick={() => setEraserSize(s)}
                    >
                      {s}px
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="settings-divider" />

          {/* Секция 3: Тема оформления */}
          <div className="settings-section">
            <h4 className="settings-section-title">Тема оформления</h4>
            <div className="settings-cards-grid">
              <button
                type="button"
                className={`settings-option-card ${theme === 'light' ? 'active' : ''}`}
                onClick={() => setTheme('light')}
              >
                <div className="settings-option-icon">
                  <Sun size={22} />
                </div>
                <div className="settings-option-info">
                  <div className="settings-option-label">Светлая тема</div>
                  <div className="settings-option-sub">Классический стиль Microsoft OneNote</div>
                </div>
                {theme === 'light' && (
                  <div className="settings-check-badge">
                    <Check size={16} />
                  </div>
                )}
              </button>

              <button
                type="button"
                className={`settings-option-card ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                <div className="settings-option-icon">
                  <Moon size={22} />
                </div>
                <div className="settings-option-info">
                  <div className="settings-option-label">Тёмная тема</div>
                  <div className="settings-option-sub">Комфортно для работы ночью</div>
                </div>
                {theme === 'dark' && (
                  <div className="settings-check-badge">
                    <Check size={16} />
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--hairline)' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setSettingsOpen(false)}
            style={{
              padding: '6px 18px',
              backgroundColor: 'var(--brand-onenote)',
              color: '#ffffff',
              borderRadius: 'var(--r-sm)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              border: 'none',
            }}
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
