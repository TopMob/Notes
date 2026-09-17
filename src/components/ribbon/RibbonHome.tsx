import React from 'react';
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Type,
  Plus,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

export const RibbonHome: React.FC = () => {
  const { addTextBlock, camera, currentPageId, canUndo, canRedo, undo, redo } = useCanvasStore();

  const handleCreateTextBlock = () => {
    if (!currentPageId) return;
    addTextBlock({
      id: `tb-${Date.now()}`,
      pageId: currentPageId,
      x: camera.x - 100,
      y: camera.y - 50,
      width: 480,
      contentHTML: '<p>Введите ваш текст здесь...</p>',
      zIndex: 10,
    });
  };

  const applyCommand = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
  };

  return (
    <div className="ribbon-toolbar">
      {/* Undo / Redo */}
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

      {/* Быстрое добавление блока */}
      <div className="toolbar-group">
        <button
          className="tool-btn highlight"
          onClick={handleCreateTextBlock}
          title="Создать текстовый блок"
        >
          <Plus size={16} />
          <span className="tool-btn-label">Новая заметка</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Форматирование шрифта */}
      <div className="toolbar-group">
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('bold');
          }}
          title="Полужирный (Ctrl+B)"
        >
          <Bold size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('italic');
          }}
          title="Курсив (Ctrl+I)"
        >
          <Italic size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('underline');
          }}
          title="Подчёркнутый (Ctrl+U)"
        >
          <Underline size={16} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-divider" />

      {/* Выбор размера шрифта */}
      <div className="toolbar-group">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Type size={16} style={{ color: 'var(--color-text-secondary)' }} />
          <select
            className="font-size-select"
            defaultValue="16"
            onChange={(e) => {
              const size = e.target.value;
              const sel = window.getSelection();
              if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
                const span = document.createElement('span');
                span.style.fontSize = `${size}px`;
                const range = sel.getRangeAt(0);
                span.appendChild(range.extractContents());
                range.insertNode(span);
              } else {
                const activeEl = document.activeElement;
                if (activeEl && activeEl.closest('.text-block-content')) {
                  (activeEl.closest('.text-block-content') as HTMLElement).style.fontSize = `${size}px`;
                }
              }
            }}
            title="Размер шрифта (px)"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            <option value="12">12 px</option>
            <option value="14">14 px</option>
            <option value="16">16 px (Обычный)</option>
            <option value="18">18 px</option>
            <option value="20">20 px</option>
            <option value="24">24 px (Большой)</option>
            <option value="28">28 px</option>
            <option value="32">32 px (Заголовок)</option>
            <option value="40">40 px</option>
          </select>
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* Списки и чекбоксы */}
      <div className="toolbar-group">
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('insertUnorderedList');
          }}
          title="Маркированный список"
        >
          <List size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('insertOrderedList');
          }}
          title="Нумерованный список"
        >
          <ListOrdered size={16} />
        </button>
      </div>
    </div>
  );
};
