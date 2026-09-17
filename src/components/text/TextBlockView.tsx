import React, { useState, useRef, useEffect } from 'react';
import katex from 'katex';
import { GripHorizontal, X } from 'lucide-react';
import { TextBlock } from '../../types/textblock';
import { Camera, ViewportSize } from '../../types/canvas';
import { Viewport } from '../../canvas/engine/Viewport';
import { useCanvasStore } from '../../store/useCanvasStore';

interface TextBlockViewProps {
  block: TextBlock;
  camera: Camera;
  viewportSize: ViewportSize;
  isActive: boolean;
  onSelect: () => void;
}

export const TextBlockView: React.FC<TextBlockViewProps> = ({
  block,
  camera,
  viewportSize,
  isActive,
  onSelect,
}) => {
  const { updateTextBlock, removeTextBlock, setTextBlockHeight } = useCanvasStore();
  const screenPos = Viewport.worldToScreen({ x: block.x, y: block.y }, camera, viewportSize);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, blockX: block.x, blockY: block.y });
  const [resizeStart, setResizeStart] = useState({ startX: 0, initialWidth: block.width });

  // Измерение высоты контейнера для идеального хитбокса
  useEffect(() => {
    if (!containerRef.current) return;
    const updateHeight = () => {
      if (containerRef.current) {
        const measuredHeight = Math.round(containerRef.current.offsetHeight / (camera.zoom || 1));
        setTextBlockHeight(block.id, measuredHeight);
      }
    };
    updateHeight();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(() => updateHeight());
      ro.observe(containerRef.current);
    }
    return () => {
      if (ro) ro.disconnect();
    };
  }, [block.id, block.contentHTML, block.width, camera.zoom, setTextBlockHeight]);

  // Авто-фокус при создании пустого блока
  useEffect(() => {
    if (isActive && contentRef.current && (!block.contentHTML || block.contentHTML === '<p></p>' || block.contentHTML === '<p><br></p>')) {
      contentRef.current.focus();
      // Установить курсор в начало
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(contentRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isActive, block.contentHTML]);

  // Рендер формул KaTeX внутри блока
  useEffect(() => {
    if (!contentRef.current) return;

    // Ищем блоки с атрибутом data-latex или формулы $...$
    const formulaBlocks = contentRef.current.querySelectorAll('.katex-rendered-block');
    formulaBlocks.forEach((el) => {
      const latex = el.getAttribute('data-latex');
      if (latex) {
        try {
          el.innerHTML = katex.renderToString(latex, {
            displayMode: true,
            throwOnError: false,
          });
        } catch {
          // fallback
        }
      }
    });
  }, [block.contentHTML]);

  // Перетаскивание блока за верхний хендл (только ЛКМ)
  const handleDragPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      blockX: block.x,
      blockY: block.y,
    });
    onSelect();
  };

  const handleDragPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = (e.clientX - dragStart.x) / camera.zoom;
    const dy = (e.clientY - dragStart.y) / camera.zoom;

    updateTextBlock(block.id, {
      x: Math.round(dragStart.blockX + dx),
      y: Math.round(dragStart.blockY + dy),
    });
  };

  const handleDragPointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  // Изменение ширины блока (правый ресайз хендл <>, только ЛКМ)
  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    setIsResizing(true);
    setResizeStart({
      startX: e.clientX,
      initialWidth: block.width,
    });
  };

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!isResizing) return;
    const dx = (e.clientX - resizeStart.startX) / camera.zoom;
    const newWidth = Math.max(180, Math.round(resizeStart.initialWidth + dx));

    updateTextBlock(block.id, { width: newWidth });
  };

  const handleResizePointerUp = (e: React.PointerEvent) => {
    if (isResizing) {
      setIsResizing(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleDoubleClickContent = (e: React.MouseEvent) => {
    e.stopPropagation();
    const target = (e.target as HTMLElement).closest('.katex-rendered-block') as HTMLElement;
    if (target) {
      const currentLatex = target.getAttribute('data-latex') || '';
      const updatedLatex = prompt('Редактировать формулу KaTeX (LaTeX):', currentLatex);
      if (updatedLatex !== null && updatedLatex.trim()) {
        target.setAttribute('data-latex', updatedLatex.trim());
        try {
          target.innerHTML = katex.renderToString(updatedLatex.trim(), {
            displayMode: true,
            throwOnError: false,
          });
        } catch {
          target.innerText = `$${updatedLatex}$`;
        }
        if (contentRef.current) {
          updateTextBlock(block.id, { contentHTML: contentRef.current.innerHTML });
        }
      }
    }
  };

  // Интерактивное изменение ширины столбцов и высоты строк таблиц OneNote
  const tableResizeRef = useRef<{
    cell: HTMLTableCellElement;
    type: 'col' | 'row';
    startX: number;
    startY: number;
    initialWidth: number;
    initialHeight: number;
  } | null>(null);

  const handleContentPointerMove = (e: React.PointerEvent) => {
    // 1. Активный ресайз столбца или строки
    if (tableResizeRef.current) {
      const { cell, type, startX, startY, initialWidth, initialHeight } = tableResizeRef.current;
      if (type === 'col') {
        const dx = (e.clientX - startX) / camera.zoom;
        const newWidth = Math.max(35, Math.round(initialWidth + dx));
        const table = cell.closest('table');
        const colIdx = cell.cellIndex;
        if (table) {
          table.style.tableLayout = 'fixed';
          for (let r = 0; r < table.rows.length; r++) {
            const c = table.rows[r].cells[colIdx];
            if (c) c.style.width = `${newWidth}px`;
          }
        } else {
          cell.style.width = `${newWidth}px`;
        }
      } else if (type === 'row') {
        const dy = (e.clientY - startY) / camera.zoom;
        const newHeight = Math.max(24, Math.round(initialHeight + dy));
        const tr = cell.parentElement as HTMLTableRowElement | null;
        if (tr) {
          tr.style.height = `${newHeight}px`;
          for (let i = 0; i < tr.cells.length; i++) {
            tr.cells[i].style.height = `${newHeight}px`;
          }
        }
      }
      return;
    }

    // 2. Индикация границы ячейки (col-resize или row-resize)
    const target = e.target as HTMLElement | null;
    const cell = target?.closest('th, td') as HTMLTableCellElement | null;
    if (cell && cell.closest('.onenote-table')) {
      const rect = cell.getBoundingClientRect();
      const isRightBorder = Math.abs(e.clientX - rect.right) <= 6;
      const isBottomBorder = Math.abs(e.clientY - rect.bottom) <= 6;

      if (isRightBorder) {
        cell.style.cursor = 'col-resize';
      } else if (isBottomBorder) {
        cell.style.cursor = 'row-resize';
      } else {
        cell.style.cursor = 'text';
      }
    }
  };

  const handleContentPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement | null;
    const cell = target?.closest('th, td') as HTMLTableCellElement | null;
    if (cell && cell.closest('.onenote-table') && e.button === 0) {
      const rect = cell.getBoundingClientRect();
      const isRightBorder = Math.abs(e.clientX - rect.right) <= 6;
      const isBottomBorder = Math.abs(e.clientY - rect.bottom) <= 6;

      if (isRightBorder || isBottomBorder) {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

        tableResizeRef.current = {
          cell,
          type: isRightBorder ? 'col' : 'row',
          startX: e.clientX,
          startY: e.clientY,
          initialWidth: cell.offsetWidth,
          initialHeight: (cell.parentElement as HTMLTableRowElement)?.offsetHeight || cell.offsetHeight,
        };
      }
    }
  };

  const handleContentPointerUp = (e: React.PointerEvent) => {
    if (tableResizeRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      tableResizeRef.current = null;
      if (contentRef.current) {
        updateTextBlock(block.id, { contentHTML: contentRef.current.innerHTML });
      }
    }
  };

  const handleBlur = () => {
    if (!contentRef.current) return;
    let html = contentRef.current.innerHTML;
    const plainText = contentRef.current.innerText.trim();

    // Авто-удаление пустого блока (OneNote поведение)
    if (!plainText && !html.includes('<img') && !html.includes('katex')) {
      removeTextBlock(block.id);
      return;
    }

    // Авто-конвертация введенных $formula$ в рендерируемые KaTeX блоки
    // Заменяет $latex$ вне существующих тегов
    if (html.includes('$')) {
      html = html.replace(/\$([^$<>\n\r]+)\$/g, '<span class="katex-rendered-block" data-latex="$1">$$1$</span>');
    }

    updateTextBlock(block.id, { contentHTML: html });
  };

  return (
    <div
      ref={containerRef}
      className={`text-block-container ${isActive ? 'selected' : ''}`}
      style={{
        position: 'absolute',
        left: `${screenPos.x}px`,
        top: `${screenPos.y}px`,
        width: `${block.width * camera.zoom}px`,
        zIndex: block.zIndex,
      }}
      onClick={onSelect}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Верхний серый Drag-Handle (фирменный хендл OneNote) */}
      <div
        className="text-block-handle"
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        title="Перетащить текстовый контейнер"
      >
        <GripHorizontal size={14} className="drag-icon" />
        <button
          className="btn-delete-block"
          onClick={(e) => {
            e.stopPropagation();
            removeTextBlock(block.id);
          }}
          title="Удалить контейнер"
        >
          <X size={12} />
        </button>
      </div>

      {/* Правый Resize-Handle (<>) */}
      <div
        className="text-block-resize-handle"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        title="Изменить ширину"
      >
        <span>↔</span>
      </div>

      {/* Редактируемое содержимое контейнера */}
      <div
        ref={contentRef}
        className="text-block-content"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Введите текст..."
        onPointerDown={handleContentPointerDown}
        onPointerMove={handleContentPointerMove}
        onPointerUp={handleContentPointerUp}
        onDoubleClick={handleDoubleClickContent}
        onBlur={handleBlur}
        onKeyDown={(e) => e.stopPropagation()}
        dangerouslySetInnerHTML={{ __html: block.contentHTML }}
        style={{
          fontSize: `${16 * camera.zoom}px`,
          lineHeight: 1.5,
          cursor: 'text',
        }}
      />
    </div>
  );
};
