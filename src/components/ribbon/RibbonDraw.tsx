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
  Hand,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

export const RibbonDraw: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    penColor,
    setPenColor,
    penWidth,
    setPenWidth,
    eraserSize,
    setEraserSize,
    quickColors,
    updateQuickColor,
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
    drawWithTouch,
    toggleDrawWithTouch,
  } = useCanvasStore();

  const [isEraserMenuOpen, setIsEraserMenuOpen] = useState(false);
  const [isWidthMenuOpen, setIsWidthMenuOpen] = useState(false);
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false);
  const [editingColorIndex, setEditingColorIndex] = useState<number | null>(null);

  const hasSelection =
    selectedStrokeIds.length > 0 ||
    selectedShapeIds.length > 0 ||
    selectedTextBlockIds.length > 0;

  const handleColorClick = (color: string, index: number) => {
    if (penColor === color) {
      // Второе нажатие: открываем выбор палитры для замены этого слота
      setEditingColorIndex(index);
    } else {
      setPenColor(color);
      setEditingColorIndex(null);
      if (activeTool !== 'pen') setActiveTool('pen');
    }
  };

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
          title="Лассо (выделяет штрихи, фигуры и текстовые блоки)"
        >
          <Lasso size={16} />
          <span className="tool-btn-label">Лассо</span>
        </button>

        <button
          className={`tool-btn ${drawWithTouch ? 'active' : ''}`}
          onClick={toggleDrawWithTouch}
          title={
            drawWithTouch
              ? 'Рисование пальцем (включено): 1 палец рисует, 2 пальца — панорамирование и зум'
              : 'Рисование пальцем (выключено): 1 палец только двигает холст, рисует только стилус'
          }
        >
          <Hand size={16} />
          <span className="tool-btn-label">Палец</span>
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
            title="Ластик (ПКМ на холсте также включает быстрый ластик)"
          >
            <Eraser size={16} />
            <span className="tool-btn-label">
              {activeTool === 'stroke-eraser' ? 'Поштриховой' : 'Ластик'}
            </span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {isEraserMenuOpen && (
            <div className="dropdown-menu" style={{ minWidth: '180px' }}>
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

              <div style={{ padding: '6px 12px 6px', borderTop: '1px solid var(--hairline)', marginTop: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--ink-secondary)', marginBottom: '6px' }}>
                  Размер (и для ПКМ): {eraserSize}px
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[8, 16, 24, 36, 48].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`tool-btn icon-only ${eraserSize === s ? 'active' : ''}`}
                      style={{ flex: 1, height: '24px', fontSize: '11px' }}
                      onClick={() => {
                        setEraserSize(s);
                        setIsEraserMenuOpen(false);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
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

      {/* Быстрая палитра цветов с возможностью замены любого слота */}
      <div className="toolbar-group color-swatches-group">
        {quickColors.map((color, idx) => (
          <div key={idx} className="color-swatch-wrapper" style={{ position: 'relative' }}>
            <button
              className={`color-swatch-btn ${penColor === color ? 'selected' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => handleColorClick(color, idx)}
              title={`Цвет ${color} (кликните повторно, чтобы изменить слот)`}
            />
            {editingColorIndex === idx && (
              <input
                type="color"
                value={color}
                autoFocus
                onChange={(e) => {
                  updateQuickColor(idx, e.target.value);
                  setPenColor(e.target.value);
                }}
                onBlur={() => setEditingColorIndex(null)}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  width: '32px',
                  height: '32px',
                  zIndex: 100,
                  cursor: 'pointer',
                }}
              />
            )}
          </div>
        ))}

        {/* Кастомный color picker */}
        <label className="color-picker-label" title="Выбрать произвольный цвет">
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

      {/* Свободный выбор толщины линии: ползунок + поле px */}
      <div className="toolbar-group">
        <div className="dropdown-wrapper">
          <button
            className="tool-btn"
            onClick={() => setIsWidthMenuOpen(!isWidthMenuOpen)}
            title="Толщина пера (кликните для настройки ползунком)"
          >
            <Minus size={16} strokeWidth={Math.min(6, Math.max(1.5, penWidth))} />
            <span className="tool-btn-label">{penWidth} px</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {isWidthMenuOpen && (
            <div className="dropdown-menu width-slider-menu" style={{ minWidth: '220px', padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  Толщина линии:
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={penWidth}
                    onChange={(e) => setPenWidth(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    style={{
                      width: '46px',
                      padding: '2px 4px',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      fontSize: '12px',
                      textAlign: 'center',
                      background: 'var(--color-bg-primary)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>px</span>
                </div>
              </div>

              {/* Ползунок */}
              <input
                type="range"
                min="1"
                max="40"
                step="1"
                value={penWidth}
                onChange={(e) => setPenWidth(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', margin: '6px 0 10px 0' }}
              />

              {/* Превью линии реальной толщины */}
              <div
                style={{
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--color-bg-secondary)',
                  borderRadius: '6px',
                  padding: '0 8px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: `${Math.min(28, penWidth)}px`,
                    width: '100%',
                    backgroundColor: penColor,
                    borderRadius: `${penWidth / 2}px`,
                  }}
                />
              </div>

              {/* Быстрые пресеты */}
              <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                {[1, 3, 5, 8, 16, 24].map((w) => (
                  <button
                    key={w}
                    className={`tool-btn icon-only ${penWidth === w ? 'active' : ''}`}
                    style={{ flex: 1, height: '24px', fontSize: '11px' }}
                    onClick={() => {
                      setPenWidth(w);
                      setIsWidthMenuOpen(false);
                    }}
                  >
                    {w}
                  </button>
                ))}
              </div>
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
