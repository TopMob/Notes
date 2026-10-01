import React, { useState, useRef } from 'react';
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  Superscript,
  Subscript,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Type,
  Plus,
  Omega,
  ChevronDown,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';
import { SymbolPickerDropdown } from './SymbolPickerDropdown';

export const RibbonHome: React.FC = () => {
  const {
    addTextBlock,
    updateTextBlockWithHistory,
    camera,
    currentPageId,
    canUndo,
    canRedo,
    undo,
    redo,
    textBlocks,
    selectedTextBlockIds,
  } = useCanvasStore();

  const [isSymbolOpen, setIsSymbolOpen] = useState(false);
  const symbolBtnRef = useRef<HTMLButtonElement | null>(null);

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

  const applyAlignment = (align: 'left' | 'center' | 'right' | 'justify') => {
    const commandMap: Record<string, string> = {
      left: 'justifyLeft',
      center: 'justifyCenter',
      right: 'justifyRight',
      justify: 'justifyFull',
    };

    const activeEl = document.activeElement;
    if (activeEl && activeEl.closest('.text-block-content')) {
      document.execCommand(commandMap[align], false);
      return;
    }

    const activeBlockId = selectedTextBlockIds[0];
    const activeBlock = textBlocks.find((b) => b.id === activeBlockId);
    if (activeBlock) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${activeBlock.contentHTML}</div>`, 'text/html');
      const container = doc.body.firstElementChild as HTMLElement;
      if (container) {
        container.style.textAlign = align;
        const blockElements = container.querySelectorAll('p, div, h1, h2, h3');
        if (blockElements.length > 0) {
          blockElements.forEach((el) => {
            (el as HTMLElement).style.textAlign = align;
          });
        }
        updateTextBlockWithHistory(
          activeBlock.id,
          { contentHTML: container.innerHTML },
          `Выравнивание: ${align}`
        );
      }
    }
  };

  const insertSymbol = (char: string) => {
    if (!currentPageId) return;

    const sel = window.getSelection();
    let insertedInCursor = false;

    if (sel && sel.rangeCount > 0) {
      const anchorNode = sel.anchorNode;
      const el =
        anchorNode?.nodeType === Node.ELEMENT_NODE
          ? (anchorNode as HTMLElement)
          : anchorNode?.parentElement;
      if (el && el.closest('.text-block-content')) {
        try {
          insertedInCursor = document.execCommand('insertText', false, char);
          if (!insertedInCursor) {
            insertedInCursor = document.execCommand('insertHTML', false, char);
          }
        } catch {
          // fallback
        }
      }
    }

    if (insertedInCursor) return;

    const activeBlockId = selectedTextBlockIds[0];
    const activeBlock = textBlocks.find((b) => b.id === activeBlockId);

    if (activeBlock) {
      updateTextBlockWithHistory(
        activeBlock.id,
        {
          contentHTML: activeBlock.contentHTML ? activeBlock.contentHTML + char : `<p>${char}</p>`,
          width: Math.max(activeBlock.width, 320),
        },
        'Вставка символа'
      );
    } else {
      const newId = `tb-${Date.now()}`;
      addTextBlock({
        id: newId,
        pageId: currentPageId,
        x: Math.round(camera.x - 100),
        y: Math.round(camera.y - 50),
        width: 360,
        contentHTML: `<p>${char}</p>`,
        zIndex: 10 + textBlocks.length,
      });
    }
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
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('superscript');
          }}
          title="Верхний индекс / степень (Ctrl+. или ввод ^x)"
        >
          <Superscript size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('subscript');
          }}
          title="Нижний индекс (Ctrl+,)"
        >
          <Subscript size={16} />
        </button>
      </div>

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

      {/* Быстрая вставка символов */}
      <div className="toolbar-group">
        <div className="dropdown-wrapper">
          <button
            ref={symbolBtnRef}
            className={`tool-btn ${isSymbolOpen ? 'active' : ''}`}
            onClick={() => setIsSymbolOpen((prev) => !prev)}
            title="Вставить специальный символ (альфа, омега, бета, корень и др.)"
          >
            <Omega size={16} />
            <span className="tool-btn-label">Символ</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          <SymbolPickerDropdown
            isOpen={isSymbolOpen}
            onClose={() => setIsSymbolOpen(false)}
            anchorRef={symbolBtnRef}
            onInsertSymbol={insertSymbol}
          />
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* Выравнивание текста (лево, центр, право, по ширине) */}
      <div className="toolbar-group">
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyAlignment('left');
          }}
          title="По левому краю (Ctrl+L)"
        >
          <AlignLeft size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyAlignment('center');
          }}
          title="По центру (Ctrl+E)"
        >
          <AlignCenter size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyAlignment('right');
          }}
          title="По правому краю (Ctrl+R)"
        >
          <AlignRight size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyAlignment('justify');
          }}
          title="По ширине (Ctrl+J)"
        >
          <AlignJustify size={16} />
        </button>
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
