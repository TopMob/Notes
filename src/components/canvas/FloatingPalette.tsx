import React, { useState } from 'react';
import {
  PenTool,
  Highlighter,
  Eraser,
  MousePointer,
  Lasso,
  GripHorizontal,
  X,
  Undo2,
  Redo2,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';
import { useUiStore } from '../../store/useUiStore';

export const FloatingPalette: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    penColor,
    setPenColor,
    quickColors,
    canUndo,
    canRedo,
    undo,
    redo,
  } = useCanvasStore();
  const { isFloatingPaletteOpen, toggleFloatingPalette } = useUiStore();

  const [position, setPosition] = useState({ x: 340, y: 140 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  if (!isFloatingPaletteOpen) return null;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPosition({
      x: Math.max(10, e.clientX - dragOffset.x),
      y: Math.max(70, e.clientY - dragOffset.y),
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  return (
    <div
      className="floating-palette"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      title="Мини-панель быстрых инструментов"
    >
      <div
        className="floating-drag-bar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <GripHorizontal size={14} />
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: '4px' }}>
          Быстрые инструменты
        </span>
        <button
          className="floating-close-btn"
          onClick={toggleFloatingPalette}
          title="Скрыть панель"
          style={{ marginLeft: 'auto' }}
        >
          <X size={12} />
        </button>
      </div>

      <div className="floating-tools-row">
        <button
          className={`floating-tool-btn ${activeTool === 'cursor' ? 'active' : ''}`}
          onClick={() => setActiveTool('cursor')}
          title="Курсор"
        >
          <MousePointer size={15} />
        </button>
        <button
          className={`floating-tool-btn ${activeTool === 'pen' ? 'active' : ''}`}
          onClick={() => setActiveTool('pen')}
          title="Ручка"
        >
          <PenTool size={15} style={{ color: activeTool === 'pen' ? penColor : undefined }} />
        </button>
        <button
          className={`floating-tool-btn ${activeTool === 'highlighter' ? 'active' : ''}`}
          onClick={() => setActiveTool('highlighter')}
          title="Маркер"
        >
          <Highlighter size={15} style={{ color: '#d4b106' }} />
        </button>
        <button
          className={`floating-tool-btn ${
            activeTool === 'point-eraser' || activeTool === 'stroke-eraser' ? 'active' : ''
          }`}
          onClick={() => setActiveTool('point-eraser')}
          title="Точечный ластик"
        >
          <Eraser size={15} />
        </button>
        <button
          className={`floating-tool-btn ${activeTool === 'lasso' ? 'active' : ''}`}
          onClick={() => setActiveTool('lasso')}
          title="Лассо"
        >
          <Lasso size={15} />
        </button>

        <div style={{ width: 1, height: 18, backgroundColor: 'var(--hairline)', margin: '0 4px' }} />

        <button
          className="floating-tool-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Отменить (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </button>
        <button
          className="floating-tool-btn"
          onClick={redo}
          disabled={!canRedo}
          title="Повторить (Ctrl+Y)"
        >
          <Redo2 size={15} />
        </button>
      </div>

      <div className="floating-colors-row">
        {quickColors.map((c, idx) => (
          <button
            key={idx}
            className={`floating-color-dot ${penColor === c ? 'selected' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => {
              setPenColor(c);
              if (activeTool !== 'pen') setActiveTool('pen');
            }}
          />
        ))}
      </div>
    </div>
  );
};
