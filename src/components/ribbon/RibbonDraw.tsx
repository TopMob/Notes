import React, { useState } from 'react';
import {
  Undo2,
  Redo2,
  MousePointer,
  Lasso,
  Eraser,
  PenTool as PenIcon,
  Highlighter as HighlighterIcon,
  Palette,
  Minus,
  ChevronDown,
  Trash2,
  Square,
  Circle,
  ArrowUpRight,
  SplitSquareVertical,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

const PRESET_COLORS = [
  { name: 'Черный', value: '#201f1e' },
  { name: 'Синий', value: '#0078d4' },
  { name: 'Зеленый', value: '#107c41' },
  { name: 'Красный', value: '#d83b01' },
  { name: 'Фиолетовый', value: '#7719aa' },
];

const STROKE_WIDTHS = [
  { label: 'Тонкая (1px)', value: 1.5 },
  { label: 'Стандарт (3px)', value: 3 },
  { label: 'Средняя (5px)', value: 5 },
  { label: 'Толстая (8px)', value: 8 },
  { label: 'Маркерная (12px)', value: 12 },
];

export const RibbonDraw: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    penColor,
    setPenColor,
    penWidth,
    setPenWidth,
    shapeType,
    setShapeType,
    deleteSelectedItems,
    selectedStrokeIds,
    selectedShapeIds,
    selectedTextBlockIds,
    canUndo,
    canRedo,
    undo,
    redo,
  } = useCanvasStore();

  const [isEraserMenuOpen, setIsEraserMenuOpen] = useState(false);
  const [isWidthMenuOpen, setIsWidthMenuOpen] = useState(false);
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false);

  const hasSelection =
    selectedStrokeIds.length > 0 ||
    selectedShapeIds.length > 0 ||
    selectedTextBlockIds.length > 0;

  return (
    <div className="ribbon-toolbar">
      {/* Группа Истории: Undo / Redo */}
      <div className="toolbar-group">
        <button
          className="tool-btn icon-only"
          onClick={undo}
          disabled={!canUndo}
          title="Отменить (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onClick={redo}
          disabled={!canRedo}
          title="Повторить (Ctrl+Y)"
        >
          <Redo2 size={16} />
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Инструменты выбора */}
      <div className="toolbar-group">
        <button
          className={`tool-btn ${activeTool === 'cursor' ? 'active' : ''}`}
          onClick={() => setActiveTool('cursor')}
          title="Выделение и перемещение"
        >
          <MousePointer size={16} />
          <span className="tool-btn-label">Курсор</span>
        </button>

        <button
          className={`tool-btn ${activeTool === 'lasso' ? 'active' : ''}`}
          onClick={() => setActiveTool('lasso')}
          title="Лассо-выделение контуром"
        >
          <Lasso size={16} />
          <span className="tool-btn-label">Лассо</span>
        </button>

        {/* Ластик с меню (по умолчанию точечный ластик) */}
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${
              activeTool === 'stroke-eraser' || activeTool === 'point-eraser' ? 'active' : ''
            }`}
            onClick={() => {
              if (activeTool !== 'stroke-eraser' && activeTool !== 'point-eraser') {
                setActiveTool('point-eraser');
              } else {
                setIsEraserMenuOpen(!isEraserMenuOpen);
              }
            }}
            title="Ластик (кликните для переключения режима)"
          >
            <Eraser size={16} />
            <span className="tool-btn-label">
              {activeTool === 'stroke-eraser' ? 'Поштриховой' : 'Ластик'}
            </span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {isEraserMenuOpen && (
            <div className="dropdown-menu">
              <button
                className={`dropdown-item ${activeTool === 'point-eraser' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTool('point-eraser');
                  setIsEraserMenuOpen(false);
                }}
              >
                <span>Точечный ластик</span>
              </button>
              <button
                className={`dropdown-item ${activeTool === 'stroke-eraser' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTool('stroke-eraser');
                  setIsEraserMenuOpen(false);
                }}
              >
                <span>Поштриховой ластик</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* Инструменты рисования: Перо и Маркер */}
      <div className="toolbar-group">
        <button
          className={`tool-btn ${activeTool === 'pen' ? 'active' : ''}`}
          onClick={() => setActiveTool('pen')}
          title="Перо для рукописного ввода"
        >
          <PenIcon size={16} style={{ color: activeTool === 'pen' ? penColor : undefined }} />
          <span className="tool-btn-label">Перо</span>
        </button>

        <button
          className={`tool-btn ${activeTool === 'highlighter' ? 'active' : ''}`}
          onClick={() => setActiveTool('highlighter')}
          title="Маркер (просвечивает через текст и линии)"
        >
          <HighlighterIcon
            size={16}
            style={{ color: activeTool === 'highlighter' ? '#d4b106' : undefined }}
          />
          <span className="tool-btn-label">Маркер</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Быстрая палитра цветов */}
      <div className="toolbar-group color-swatches-group">
        {PRESET_COLORS.map((c) => (
          <button
            key={c.value}
            className={`color-swatch-btn ${penColor === c.value ? 'selected' : ''}`}
            style={{ backgroundColor: c.value }}
            onClick={() => {
              setPenColor(c.value);
              if (activeTool !== 'pen') setActiveTool('pen');
            }}
            title={c.name}
          />
        ))}

        {/* Кастомный color picker */}
        <label className="color-picker-label" title="Выбрать другой цвет">
          <Palette size={16} />
          <input
            type="color"
            value={penColor}
            onChange={(e) => {
              setPenColor(e.target.value);
              if (activeTool !== 'pen') setActiveTool('pen');
            }}
            className="hidden-color-input"
          />
        </label>
      </div>

      <div className="toolbar-divider" />

      {/* Толщина линии */}
      <div className="toolbar-group">
        <div className="dropdown-wrapper">
          <button
            className="tool-btn"
            onClick={() => setIsWidthMenuOpen(!isWidthMenuOpen)}
            title="Толщина пера"
          >
            <Minus size={16} strokeWidth={Math.min(5, Math.max(1.5, penWidth))} />
            <span className="tool-btn-label">{penWidth}px</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {isWidthMenuOpen && (
            <div className="dropdown-menu">
              {STROKE_WIDTHS.map((w) => (
                <button
                  key={w.value}
                  className={`dropdown-item ${penWidth === w.value ? 'active' : ''}`}
                  onClick={() => {
                    setPenWidth(w.value);
                    setIsWidthMenuOpen(false);
                  }}
                >
                  <div
                    className="width-preview-line"
                    style={{
                      height: `${Math.min(8, w.value)}px`,
                      backgroundColor: penColor,
                      width: '32px',
                    }}
                  />
                  <span>{w.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* Фигуры */}
      <div className="toolbar-group">
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${activeTool === 'shape' ? 'active' : ''}`}
            onClick={() => {
              if (activeTool !== 'shape') setActiveTool('shape');
              else setIsShapeMenuOpen(!isShapeMenuOpen);
            }}
            title="Фигуры (линия, стрелка, прямоугольник, эллипс, оси)"
          >
            {shapeType === 'rect' && <Square size={16} />}
            {shapeType === 'ellipse' && <Circle size={16} />}
            {shapeType === 'line' && <Minus size={16} />}
            {shapeType === 'arrow' && <ArrowUpRight size={16} />}
            {shapeType === 'axis' && <SplitSquareVertical size={16} />}
            <span className="tool-btn-label">Фигуры</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {isShapeMenuOpen && (
            <div className="dropdown-menu">
              <button
                className={`dropdown-item ${shapeType === 'line' ? 'active' : ''}`}
                onClick={() => {
                  setShapeType('line');
                  setActiveTool('shape');
                  setIsShapeMenuOpen(false);
                }}
              >
                <Minus size={15} />
                <span>Прямая линия</span>
              </button>
              <button
                className={`dropdown-item ${shapeType === 'arrow' ? 'active' : ''}`}
                onClick={() => {
                  setShapeType('arrow');
                  setActiveTool('shape');
                  setIsShapeMenuOpen(false);
                }}
              >
                <ArrowUpRight size={15} />
                <span>Стрелка</span>
              </button>
              <button
                className={`dropdown-item ${shapeType === 'rect' ? 'active' : ''}`}
                onClick={() => {
                  setShapeType('rect');
                  setActiveTool('shape');
                  setIsShapeMenuOpen(false);
                }}
              >
                <Square size={15} />
                <span>Прямоугольник</span>
              </button>
              <button
                className={`dropdown-item ${shapeType === 'ellipse' ? 'active' : ''}`}
                onClick={() => {
                  setShapeType('ellipse');
                  setActiveTool('shape');
                  setIsShapeMenuOpen(false);
                }}
              >
                <Circle size={15} />
                <span>Эллипс</span>
              </button>
              <button
                className={`dropdown-item ${shapeType === 'axis' ? 'active' : ''}`}
                onClick={() => {
                  setShapeType('axis');
                  setActiveTool('shape');
                  setIsShapeMenuOpen(false);
                }}
              >
                <SplitSquareVertical size={15} />
                <span>Оси координат X/Y</span>
              </button>
            </div>
          )}
        </div>

        {/* Кнопка удаления выделенного */}
        {hasSelection && (
          <button
            className="tool-btn danger"
            onClick={deleteSelectedItems}
            title="Удалить выделенные элементы (Del)"
          >
            <Trash2 size={16} />
            <span className="tool-btn-label">Удалить</span>
          </button>
        )}
      </div>
    </div>
  );
};
