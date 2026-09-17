import React, { useState } from 'react';
import {
  FileText,
  Sigma,
  Grid3X3,
  Calendar,
  ChevronDown,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

export const RibbonInsert: React.FC = () => {
  const { addTextBlock, camera, currentPageId } = useCanvasStore();
  const [isEquationMenuOpen, setIsEquationMenuOpen] = useState(false);

  const insertTextContainer = (initialHtml = '<p>Введите текст...</p>', width = 460) => {
    if (!currentPageId) return;
    addTextBlock({
      id: `tb-${Date.now()}`,
      pageId: currentPageId,
      x: camera.x - 120,
      y: camera.y - 40,
      width,
      contentHTML: initialHtml,
      zIndex: 10,
    });
  };

  const insertFormula = (latex: string) => {
    const html = `<p>Формула:</p><div class="katex-rendered-block" data-latex="${latex}">$${latex}$</div><p></p>`;
    insertTextContainer(html, 520);
    setIsEquationMenuOpen(false);
  };

  const insertMatrix = () => {
    const matrixLatex = `\\begin{pmatrix} a_{11} & a_{12} & | & b_1 \\\\ a_{21} & a_{22} & | & b_2 \\end{pmatrix}`;
    insertFormula(matrixLatex);
  };

  const insertDate = () => {
    const now = new Date();
    const formatted = now.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    insertTextContainer(`<p><strong>${formatted}</strong></p>`);
  };

  return (
    <div className="ribbon-toolbar">
      {/* Текстовый блок */}
      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={() => insertTextContainer()}
          title="Вставить текстовый контейнер в позицию обзора"
        >
          <FileText size={16} />
          <span className="tool-btn-label">Текстовый блок</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Математические формулы KaTeX */}
      <div className="toolbar-group">
        <div className="dropdown-wrapper">
          <button
            className="tool-btn"
            onClick={() => setIsEquationMenuOpen(!isEquationMenuOpen)}
            title="Вставить математическую формулу KaTeX"
          >
            <Sigma size={16} />
            <span className="tool-btn-label">Формула</span>
            <ChevronDown size={11} className="chevron" />
          </button>

          {isEquationMenuOpen && (
            <div className="dropdown-menu">
              <button
                className="dropdown-item"
                onClick={() => insertFormula('X_2 = \\frac{-4}{-4} = 1')}
              >
                <span>Дробное уравнение: $X_2 = \\frac{-4}{-4} = 1$</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('E = mc^2')}
              >
                <span>Энергия: $E = mc^2$</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')}
              >
                <span>Квадратное уравнение: дискриминант</span>
              </button>
              <button
                className="dropdown-item"
                onClick={() => insertFormula('\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}')}
              >
                <span>Интеграл Пуассона</span>
              </button>
            </div>
          )}
        </div>

        {/* Матрица Гаусса */}
        <button
          className="tool-btn"
          onClick={insertMatrix}
          title="Вставить матрицу системы линейных уравнений"
        >
          <Grid3X3 size={16} />
          <span className="tool-btn-label">Матрица</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Штамп даты и времени */}
      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={insertDate}
          title="Вставить текущую дату и время"
        >
          <Calendar size={16} />
          <span className="tool-btn-label">Дата и время</span>
        </button>
      </div>
    </div>
  );
};
