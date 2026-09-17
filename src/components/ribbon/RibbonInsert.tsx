import React, { useState, useRef } from 'react';
import {
  FileText,
  Table,
  Sigma,
  Grid3X3,
  Calendar,
  ChevronDown,
  ListTodo,
  Lightbulb,
  Code,
  Minus,
  Image as ImageIcon,
  Pi,
  AlertTriangle,
  Bookmark,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

export const RibbonInsert: React.FC = () => {
  const {
    addTextBlock,
    updateTextBlock,
    camera,
    currentPageId,
    textBlocks,
    selectedTextBlockIds,
  } = useCanvasStore();

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const toggleDropdown = (name: string) => {
    setActiveDropdown((prev) => (prev === name ? null : name));
  };

  const closeDropdowns = () => setActiveDropdown(null);

  // Универсальная вставка фрагмента HTML:
  // Если выделен текстовый блок — вставляет в него (или по позиции курсора).
  // Если нет — создает аккуратный блок по центру текущего обзора.
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
      updateTextBlock(activeBlock.id, {
        contentHTML: activeBlock.contentHTML + htmlSnippet,
        width: Math.max(activeBlock.width, defaultWidth),
      });
    } else {
      const newId = `tb-${Date.now()}`;
      addTextBlock({
        id: newId,
        pageId: currentPageId,
        x: Math.round(camera.x - defaultWidth / 2),
        y: Math.round(camera.y - 60),
        width: defaultWidth,
        contentHTML: htmlSnippet,
        zIndex: 10 + textBlocks.length,
      });
      useCanvasStore.getState().setSelection([], [], [newId]);
    }
  };

  // Вставка таблицы OneNote
  const insertTable = (rows: number, cols: number) => {
    let html = '<table class="onenote-table"><thead><tr>';
    for (let c = 1; c <= cols; c++) {
      html += `<th>Колонка ${c}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let r = 1; r <= rows; r++) {
      html += '<tr>';
      for (let c = 1; c <= cols; c++) {
        html += `<td>Ячейка ${r}.${c}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table><p></p>';
    insertContent(html, Math.max(460, cols * 130));
  };

  // Вставка формулы KaTeX
  const insertFormula = (latex: string) => {
    const html = `<div class="katex-rendered-block katex-display-block" data-latex="${latex}">$${latex}$</div><p></p>`;
    insertContent(html, 520);
  };

  // Пользовательская формула через prompt
  const handleCustomFormula = () => {
    closeDropdowns();
    const latex = prompt(
      'Введите формулу в формате LaTeX (например: \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} или \\int_{a}^{b} f(x)dx):',
      '\\sqrt{a^2 + b^2}'
    );
    if (latex && latex.trim()) {
      insertFormula(latex.trim());
    }
  };

  // Вставка даты и времени
  const insertDateTime = (mode: 'full' | 'date' | 'time') => {
    const now = new Date();
    let text = '';
    if (mode === 'full') {
      text = now.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } else if (mode === 'date') {
      text = now.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } else {
      text = now.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    insertContent(`<p><strong>📅 ${text}</strong></p>`);
  };

  // Вставка списка задач
  const insertChecklist = () => {
    const html = `
      <p><strong>Список задач:</strong></p>
      <div class="todo-item"><input type="checkbox" /> <span>Задача 1</span></div>
      <div class="todo-item"><input type="checkbox" /> <span>Задача 2</span></div>
      <div class="todo-item"><input type="checkbox" /> <span>Задача 3</span></div>
      <p></p>
    `;
    insertContent(html, 380);
  };

  // Вставка выноски (Callout)
  const insertCallout = (type: 'info' | 'warning' | 'success') => {
    let title = '💡 Заметка / Идея';
    let text = 'Здесь можно записать важное примечание, вывод или ключевую мысль.';
    if (type === 'warning') {
      title = '⚠️ Важно / Внимание';
      text = 'Обратите внимание на этот пункт при выполнении расчетов или конспектировании.';
    } else if (type === 'success') {
      title = '📌 Определение';
      text = 'Формулировка основного правила, теоремы или математического определения.';
    }

    const html = `
      <blockquote class="onenote-callout callout-${type}">
        <div class="onenote-callout-title">${title}</div>
        <p>${text}</p>
      </blockquote>
      <p></p>
    `;
    insertContent(html, 480);
  };

  // Вставка блока кода
  const insertCodeBlock = () => {
    const html = `
      <pre class="onenote-code-block"><code>// Исходный код программы
function calculate() {
  console.log("OneNote Web");
}</code></pre>
      <p></p>
    `;
    insertContent(html, 480);
  };

  // Вставка разделителя
  const insertDivider = () => {
    insertContent('<hr class="onenote-divider" /><p></p>');
  };

  // Вставка символа
  const insertSymbol = (sym: string) => {
    insertContent(`<span>${sym} </span>`);
  };

  // Загрузка изображения с диска
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const html = `<p><img src="${dataUrl}" alt="Загруженное изображение" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); margin: 8px 0;" /></p><p></p>`;
      insertContent(html, 540);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const mathSymbols = [
    'π', 'α', 'β', 'γ', 'Δ', 'θ',
    'λ', 'μ', 'Ω', '∞', '±', '≈',
    '≠', '≤', '≥', '→', '√', '∂'
  ];

  return (
    <div className="ribbon-toolbar">
      {/* 1. Текстовый блок */}
      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={() => insertContent('<p>Введите текст заметки...</p>', 460)}
          title="Вставить текстовый контейнер на холст"
        >
          <FileText size={16} />
          <span className="tool-btn-label">Текстовый блок</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* 2. Таблица */}
      <div className="toolbar-group">
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${activeDropdown === 'table' ? 'active' : ''}`}
            onClick={() => toggleDropdown('table')}
            title="Вставить интерактивную таблицу OneNote"
          >
            <Table size={16} />
            <span className="tool-btn-label">Таблица</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {activeDropdown === 'table' && (
            <div className="dropdown-menu">
              <div className="dropdown-header">Размер таблицы</div>
              <button className="dropdown-item" onClick={() => insertTable(2, 2)}>
                <span>Таблица 2 × 2</span>
              </button>
              <button className="dropdown-item" onClick={() => insertTable(3, 3)}>
                <span>Таблица 3 × 3 (стандарт)</span>
              </button>
              <button className="dropdown-item" onClick={() => insertTable(4, 4)}>
                <span>Таблица 4 × 4</span>
              </button>
              <button className="dropdown-item" onClick={() => insertTable(2, 5)}>
                <span>Таблица 2 × 5 (параметры)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* 3. Математика: Формулы KaTeX и Матрицы */}
      <div className="toolbar-group">
        {/* Формулы */}
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${activeDropdown === 'equation' ? 'active' : ''}`}
            onClick={() => toggleDropdown('equation')}
            title="Вставить математическую формулу KaTeX"
          >
            <Sigma size={16} />
            <span className="tool-btn-label">Формула</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {activeDropdown === 'equation' && (
            <div className="dropdown-menu" style={{ minWidth: 260 }}>
              <div className="dropdown-header">Пользовательская формула</div>
              <button className="dropdown-item" onClick={handleCustomFormula}>
                <span>✍ Ввести формулу (LaTeX)...</span>
              </button>
              <div className="dropdown-header">Готовые формулы</div>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')}
              >
                <span>Квадратное уравнение</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('X_2 = \\frac{-4}{-4} = 1')}
              >
                <span>Дробь: $X_2 = \\frac{-4}{-4} = 1$</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}')}
              >
                <span>Интеграл Пуассона</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1')}
              >
                <span>Замечательный предел</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}')}
              >
                <span>Сумма ряда (Базель)</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('E = mc^2')}
              >
                <span>Энергия: $E = mc^2$</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('a^2 + b^2 = c^2')}
              >
                <span>Теорема Пифагора</span>
              </button>
            </div>
          )}
        </div>

        {/* Матрицы */}
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${activeDropdown === 'matrix' ? 'active' : ''}`}
            onClick={() => toggleDropdown('matrix')}
            title="Вставить матрицу или систему линейных уравнений"
          >
            <Grid3X3 size={16} />
            <span className="tool-btn-label">Матрица</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {activeDropdown === 'matrix' && (
            <div className="dropdown-menu" style={{ minWidth: 260 }}>
              <div className="dropdown-header">Шаблоны матриц</div>
              <button
                className="dropdown-item"
                onClick={() =>
                  insertFormula(
                    '\\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix}'
                  )
                }
              >
                <span>Матрица 2 × 2</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() =>
                  insertFormula(
                    '\\begin{pmatrix} a_{11} & a_{12} & a_{13} \\\\ a_{21} & a_{22} & a_{23} \\\\ a_{31} & a_{32} & a_{33} \\end{pmatrix}'
                  )
                }
              >
                <span>Матрица 3 × 3</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() =>
                  insertFormula(
                    '\\left(\\begin{array}{ccc|c} 1 & 2 & -1 & 4 \\\\ 2 & -1 & 3 & 9 \\\\ 3 & 1 & -2 & 1 \\end{array}\\right)'
                  )
                }
              >
                <span>Расширенная матрица (СЛАУ Гаусса)</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() =>
                  insertFormula('\\begin{pmatrix} x \\\\ y \\\\ z \\end{pmatrix}')
                }
              >
                <span>Вектор-столбец 3 × 1</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() =>
                  insertFormula(
                    '\\begin{pmatrix} 1 & 0 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0 & 1 \\end{pmatrix}'
                  )
                }
              >
                <span>Единичная матрица I₃</span>
              </button>
            </div>
          )}
        </div>

        {/* Символы */}
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${activeDropdown === 'symbols' ? 'active' : ''}`}
            onClick={() => toggleDropdown('symbols')}
            title="Вставить научные и математические символы"
          >
            <Pi size={16} />
            <span className="tool-btn-label">Символ</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {activeDropdown === 'symbols' && (
            <div className="dropdown-menu">
              <div className="dropdown-header">Символы и операторы</div>
              <div className="symbol-grid">
                {mathSymbols.map((sym) => (
                  <button
                    key={sym}
                    className="symbol-btn"
                    onClick={() => insertSymbol(sym)}
                    title={`Вставить символ ${sym}`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* 4. Задачи и структуры */}
      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={insertChecklist}
          title="Вставить список задач с чекбоксами (OneNote To-Do)"
        >
          <ListTodo size={16} />
          <span className="tool-btn-label">Список задач</span>
        </button>

        {/* Выноски */}
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${activeDropdown === 'callout' ? 'active' : ''}`}
            onClick={() => toggleDropdown('callout')}
            title="Вставить выноску или акцентную плашку"
          >
            <Lightbulb size={16} />
            <span className="tool-btn-label">Выноска</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {activeDropdown === 'callout' && (
            <div className="dropdown-menu">
              <button
                className="dropdown-item"
                onClick={() => insertCallout('info')}
              >
                <Lightbulb size={14} className="onenote-purple" />
                <span>💡 Заметка / Идея</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertCallout('warning')}
              >
                <AlertTriangle size={14} style={{ color: '#d83b01' }} />
                <span>⚠️ Важно / Предупреждение</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertCallout('success')}
              >
                <Bookmark size={14} style={{ color: '#107c41' }} />
                <span>📌 Определение / Правило</span>
              </button>
            </div>
          )}
        </div>

        <button
          className="tool-btn"
          onClick={insertCodeBlock}
          title="Вставить блок исходного кода"
        >
          <Code size={16} />
          <span className="tool-btn-label">Код</span>
        </button>

        <button
          className="tool-btn"
          onClick={insertDivider}
          title="Вставить горизонтальный разделитель"
        >
          <Minus size={16} />
          <span className="tool-btn-label">Разделитель</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* 5. Дата и время */}
      <div className="toolbar-group">
        <div className="dropdown-wrapper">
          <button
            className={`tool-btn ${activeDropdown === 'datetime' ? 'active' : ''}`}
            onClick={() => toggleDropdown('datetime')}
            title="Вставить текущую дату и время"
          >
            <Calendar size={16} />
            <span className="tool-btn-label">Дата и время</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {activeDropdown === 'datetime' && (
            <div className="dropdown-menu">
              <button
                className="dropdown-item"
                onClick={() => insertDateTime('full')}
              >
                <span>Дата и время (17 сентября 2026, 18:50)</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertDateTime('date')}
              >
                <span>Только дата (17.09.2026)</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertDateTime('time')}
              >
                <span>Только время (18:50)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* 6. Изображение */}
      <div className="toolbar-group">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageFileChange}
        />
        <button
          className="tool-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Вставить изображение с компьютера"
        >
          <ImageIcon size={16} />
          <span className="tool-btn-label">Рисунок</span>
        </button>
      </div>
    </div>
  );
};
