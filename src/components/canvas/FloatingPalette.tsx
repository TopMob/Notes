import React, { useState } from 'react';
import {
  PenTool,
  Highlighter,
  Eraser,
  MousePointer,
  Lasso,
  GripHorizontal,
  X,
  FileText,
  Maximize2,
  Minimize2,
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
    canUndo,
    canRedo,
    undo,
    redo,
    camera,
    currentPageId,
    addTextBlock,
  } = useCanvasStore();
  const { isFloatingPaletteOpen, toggleFloatingPalette, isZenMode, toggleZenMode } = useUiStore();

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

  const colors = ['#201f1e', '#0078d4', '#107c41', '#d83b01', '#7719aa'];

  return (
    <div
      className="floating-palette"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      <div
        className="floating-drag-bar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <GripHorizontal size={14} />
        <button
          className="floating-close-btn"
          onClick={toggleFloatingPalette}
          title="Скрыть мини-палитру"
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

        <div style={{ width: 1, height: 18, backgroundColor: 'var(--hairline)', margin: '0 2px' }} />

        <button
          className="floating-tool-btn"
          onClick={() => {
            if (!currentPageId) return;
            const newId = `tb-${Date.now()}`;
            addTextBlock({
              id: newId,
              pageId: currentPageId,
              x: Math.round(camera.x - 140),
              y: Math.round(camera.y - 40),
              width: 380,
              contentHTML: '<p>Введите текст...</p>',
              zIndex: 10,
            });
            useCanvasStore.getState().setSelection([], [], [newId]);
          }}
          title="Вставить текстовый блок"
        >
          <FileText size={15} />
        </button>

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

        <button
          className={`floating-tool-btn ${isZenMode ? 'active' : ''}`}
          onClick={toggleZenMode}
          title={isZenMode ? 'Выйти из Zen-режима (Esc)' : 'Zen-режим (полный экран)'}
        >
          {isZenMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>

      <div className="floating-colors-row">
        {colors.map((c) => (
          <button
            key={c}
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
