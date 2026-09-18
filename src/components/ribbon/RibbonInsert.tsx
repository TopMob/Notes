import React, { useState, useRef } from 'react';
import {
  Table,
  Grid3X3,
  Image as ImageIcon,
  ChevronDown,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

export const RibbonInsert: React.FC = () => {
  const {
    addTextBlock,
    updateTextBlockWithHistory,
    camera,
    currentPageId,
    textBlocks,
    selectedTextBlockIds,
  } = useCanvasStore();

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [tableHoverGrid, setTableHoverGrid] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [matrixRows, setMatrixRows] = useState(3);
  const [matrixCols, setMatrixCols] = useState(3);
  const [matrixType, setMatrixType] = useState<'pmatrix' | 'bmatrix' | 'vmatrix'>('pmatrix');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const toggleDropdown = (name: string) => {
    setActiveDropdown((prev) => {
      const next = prev === name ? null : name;
      if (next === 'table') setTableHoverGrid({ r: 0, c: 0 });
      return next;
    });
  };

  const closeDropdowns = () => setActiveDropdown(null);

  const insertContent = (htmlSnippet: string, defaultWidth = 460) => {
    if (!currentPageId) return;
    closeDropdowns();

    const activeEl = document.activeElement;
    if (activeEl && activeEl.closest('.text-block-content')) {
      try {
        const success = document.execCommand('insertHTML', false, htmlSnippet);
        if (success) return;
      } catch {
        // fallback
      }
    }

    const activeBlockId = selectedTextBlockIds[0];
    const activeBlock = textBlocks.find((b) => b.id === activeBlockId);

    if (activeBlock) {
      updateTextBlockWithHistory(
        activeBlock.id,
        {
          contentHTML: activeBlock.contentHTML + htmlSnippet,
          width: Math.max(activeBlock.width, defaultWidth),
        },
        'Вставка содержимого'
      );
    } else {
      const newId = `tb-${Date.now()}`;
      addTextBlock({
        id: newId,
        pageId: currentPageId,
        x: Math.round(-camera.x + 80),
        y: Math.round(-camera.y + 120),
        width: defaultWidth,
        contentHTML: htmlSnippet,
        zIndex: 10 + textBlocks.length,
      });
    }
  };

  // Вставка таблицы
  const insertTable = (rows: number, cols: number) => {
    let tableHtml = '<table class="notes-table" style="border-collapse: collapse; width: 100%; margin: 8px 0;"><tbody>';
    for (let i = 0; i < rows; i++) {
      tableHtml += '<tr>';
      for (let j = 0; j < cols; j++) {
        tableHtml += '<td style="border: 1px solid #c8c6c4; padding: 6px 10px; min-width: 40px;">&nbsp;</td>';
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table><p></p>';
    insertContent(tableHtml, Math.max(380, cols * 80));
  };

  // Вставка матрицы KaTeX
  const insertMatrix = (rows: number, cols: number, type: string) => {
    let latex = `\\begin{${type}}\n`;
    for (let i = 0; i < rows; i++) {
      const rowVals = [];
      for (let j = 0; j < cols; j++) {
        rowVals.push(`a_{${i + 1}${j + 1}}`);
      }
      latex += '  ' + rowVals.join(' & ') + (i < rows - 1 ? ' \\\\\n' : '\n');
    }
    latex += `\\end{${type}}`;

    const html = `<div class="katex-rendered-block katex-display-block" data-latex="${latex}">$${latex}$</div><p></p>`;
    insertContent(html, 380);
  };

  // Вставка изображения
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        insertContent(
          `<div class="image-wrapper"><img src="${dataUrl}" alt="${file.name}" style="max-width: 100%; border-radius: 6px;" /></div><p></p>`,
          540
        );
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const GRID_ROWS = 8;
  const GRID_COLS = 8;

  return (
    <div className="ribbon-toolbar">
      {/* 1. Таблица с интерактивной сеткой (как в Microsoft Word) */}
      <div className="toolbar-group">
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${activeDropdown === 'table' ? 'active' : ''}`}
            onClick={() => toggleDropdown('table')}
            title="Вставить таблицу (выбор размера по сетке)"
          >
            <Table size={16} />
            <span className="tool-btn-label">Таблица</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {activeDropdown === 'table' && (
            <div
              className="dropdown-menu word-table-grid-menu"
              style={{ minWidth: '200px', padding: '12px' }}
              onMouseLeave={() => setTableHoverGrid({ r: 0, c: 0 })}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  marginBottom: '8px',
                  color: 'var(--ink-secondary)',
                  textAlign: 'center',
                  height: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {tableHoverGrid.r > 0 && tableHoverGrid.c > 0
                  ? `Таблица ${tableHoverGrid.r} × ${tableHoverGrid.c}`
                  : 'Вставка таблицы'}
              </div>

              {/* Интерактивная матрица квадратиков */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${GRID_COLS}, 18px)`,
                  gridGap: '3px',
                  justifyContent: 'center',
                  padding: '6px',
                  background: 'var(--bg-app)',
                  border: '1px solid var(--hairline-subtle)',
                  borderRadius: '6px',
                }}
              >
                {Array.from({ length: GRID_ROWS }).map((_, rowIdx) =>
                  Array.from({ length: GRID_COLS }).map((_, colIdx) => {
                    const r = rowIdx + 1;
                    const c = colIdx + 1;
                    const isSelected =
                      tableHoverGrid.r > 0 &&
                      tableHoverGrid.c > 0 &&
                      r <= tableHoverGrid.r &&
                      c <= tableHoverGrid.c;
                    return (
                      <div
                        key={`${r}-${c}`}
                        onMouseEnter={() => setTableHoverGrid({ r, c })}
                        onClick={() => insertTable(r, c)}
                        style={{
                          width: '18px',
                          height: '18px',
                          border: isSelected
                            ? '1px solid var(--brand-onenote, #7719aa)'
                            : '1px solid var(--hairline, #d1d5db)',
                          backgroundColor: isSelected
                            ? 'rgba(119, 25, 170, 0.25)'
                            : 'var(--bg-hover, #edebe9)',
                          borderRadius: '2px',
                          cursor: 'pointer',
                          transition: 'background-color 0.1s ease, border-color 0.1s ease',
                        }}
                      />
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* 2. Матрица KaTeX */}
      <div className="toolbar-group">
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${activeDropdown === 'matrix' ? 'active' : ''}`}
            onClick={() => toggleDropdown('matrix')}
            title="Вставить математическую матрицу"
          >
            <Grid3X3 size={16} />
            <span className="tool-btn-label">Матрица</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {activeDropdown === 'matrix' && (
            <div
              className="dropdown-menu"
              style={{ minWidth: '240px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-secondary)' }}>
                Параметры матрицы:
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px' }}>Строк:</span>
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={matrixRows}
                  onChange={(e) => setMatrixRows(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                  style={{
                    width: '50px',
                    padding: '2px 6px',
                    border: '1px solid var(--hairline)',
                    borderRadius: '4px',
                    textAlign: 'center',
                    background: 'var(--bg-app)',
                    color: 'var(--ink)',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px' }}>Столбцов:</span>
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={matrixCols}
                  onChange={(e) => setMatrixCols(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                  style={{
                    width: '50px',
                    padding: '2px 6px',
                    border: '1px solid var(--hairline)',
                    borderRadius: '4px',
                    textAlign: 'center',
                    background: 'var(--bg-app)',
                    color: 'var(--ink)',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px' }}>Тип скобок:</span>
                <select
                  value={matrixType}
                  onChange={(e) => setMatrixType(e.target.value as any)}
                  style={{
                    padding: '3px 6px',
                    border: '1px solid var(--hairline)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    background: 'var(--bg-app)',
                    color: 'var(--ink)',
                  }}
                >
                  <option value="pmatrix">( ) круглые</option>
                  <option value="bmatrix">[ ] квадратные</option>
                  <option value="vmatrix">| | определитель</option>
                </select>
              </div>

              <button
                className="tool-btn highlight"
                onClick={() => insertMatrix(matrixRows, matrixCols, matrixType)}
                style={{ justifyContent: 'center', marginTop: '4px' }}
              >
                Вставить матрицу {matrixRows}×{matrixCols}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* 3. Изображение */}
      <div className="toolbar-group">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageUpload}
        />
        <button
          className="tool-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Вставить картинку"
        >
          <ImageIcon size={16} />
          <span className="tool-btn-label">Рисунок</span>
        </button>
      </div>
    </div>
  );
};
