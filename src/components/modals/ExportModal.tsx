import React from 'react';
import { X, Image, FileJson, Printer, Download, Upload } from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { drawStrokeToCanvas } from '../../canvas/stroke/freehand';
import { drawShapeToCanvas } from '../../canvas/stroke/shapes';
import { getDB } from '../../db/idb';

export const ExportModal: React.FC = () => {
  const { isExportOpen, setExportOpen } = useUiStore();
  const { strokes, shapes, textBlocks } = useCanvasStore();
  const { activePage } = useNotebookStore();

  if (!isExportOpen) return null;

  // Экспорт страницы в PNG
  const handleExportPng = () => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const s of strokes) {
      minX = Math.min(minX, s.bounds.minX);
      minY = Math.min(minY, s.bounds.minY);
      maxX = Math.max(maxX, s.bounds.maxX);
      maxY = Math.max(maxY, s.bounds.maxY);
    }

    for (const sh of shapes) {
      minX = Math.min(minX, sh.bounds.minX);
      minY = Math.min(minY, sh.bounds.minY);
      maxX = Math.max(maxX, sh.bounds.maxX);
      maxY = Math.max(maxY, sh.bounds.maxY);
    }

    for (const tb of textBlocks) {
      minX = Math.min(minX, tb.x);
      minY = Math.min(minY, tb.y);
      maxX = Math.max(maxX, tb.x + tb.width);
      maxY = Math.max(maxY, tb.y + 150);
    }

    if (minX === Infinity) {
      minX = -100;
      minY = -100;
      maxX = 800;
      maxY = 600;
    }

    const padding = 50;
    const width = Math.max(400, maxX - minX + padding * 2);
    const height = Math.max(300, maxY - minY + padding * 2);

    const offscreen = document.createElement('canvas');
    offscreen.width = width * 2; // Retina 2x
    offscreen.height = height * 2;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.scale(2, 2);

    // Белый фон
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Смещение начала координат
    ctx.translate(padding - minX, padding - minY);

    // Отрисовка маркеров
    for (const s of strokes) {
      if (s.tool === 'highlighter') drawStrokeToCanvas(ctx, s);
    }
    // Отрисовка чернил
    for (const s of strokes) {
      if (s.tool === 'pen') drawStrokeToCanvas(ctx, s);
    }
    // Отрисовка фигур
    for (const sh of shapes) {
      drawShapeToCanvas(ctx, sh);
    }

    // Текстовые блоки
    ctx.font = '16px Inter, sans-serif';
    ctx.fillStyle = '#201f1e';
    for (const tb of textBlocks) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = tb.contentHTML;
      const lines = tempDiv.innerText.split('\n');
      let lineY = tb.y + 20;
      for (const line of lines) {
        if (line.trim()) {
          ctx.fillText(line.trim(), tb.x, lineY);
          lineY += 24;
        }
      }
    }

    const dataUrl = offscreen.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `OneNote_${activePage?.title || 'Note'}.png`;
    a.click();
    setExportOpen(false);
  };

  // Экспорт всей базы в JSON-бэкап
  const handleExportJson = async () => {
    const db = await getDB();
    const data = {
      notebooks: await db.getAll('notebooks'),
      sections: await db.getAll('sections'),
      pages: await db.getAll('pages'),
      strokes: await db.getAll('strokes'),
      shapes: await db.getAll('shapes'),
      textBlocks: await db.getAll('textBlocks'),
      exportDate: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onenote_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  // Импорт из JSON-бэкапа
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const db = await getDB();
        const tx = db.transaction(
          ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'],
          'readwrite'
        );

        if (Array.isArray(json.notebooks)) {
          for (const nb of json.notebooks) await tx.objectStore('notebooks').put(nb);
        }
        if (Array.isArray(json.sections)) {
          for (const sec of json.sections) await tx.objectStore('sections').put(sec);
        }
        if (Array.isArray(json.pages)) {
          for (const pg of json.pages) await tx.objectStore('pages').put(pg);
        }
        if (Array.isArray(json.strokes)) {
          for (const st of json.strokes) await tx.objectStore('strokes').put(st);
        }
        if (Array.isArray(json.shapes)) {
          for (const sh of json.shapes) await tx.objectStore('shapes').put(sh);
        }
        if (Array.isArray(json.textBlocks)) {
          for (const tb of json.textBlocks) await tx.objectStore('textBlocks').put(tb);
        }

        await tx.done;
        alert('Данные успешно импортированы! Страница будет перезагружена.');
        window.location.reload();
      } catch (err) {
        alert('Ошибка при чтении файла бэкапа: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="modal-backdrop" onClick={() => setExportOpen(false)}>
      <div className="modal-content export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Экспорт и управление данными</h3>
          <button className="modal-close-btn" onClick={() => setExportOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="export-options-grid">
            <button className="export-card" onClick={handleExportPng}>
              <div className="export-card-icon">
                <Image size={24} />
              </div>
              <div className="export-card-info">
                <h4>Снимок в PNG</h4>
                <p>Экспорт текущей страницы с формулами, текстом и рукописным вводом</p>
              </div>
              <Download size={18} className="card-action-icon" />
            </button>

            <button className="export-card" onClick={handleExportJson}>
              <div className="export-card-icon">
                <FileJson size={24} />
              </div>
              <div className="export-card-info">
                <h4>Резервная копия (JSON)</h4>
                <p>Полный бэкап всех блокнотов, разделов, рукописных штрихов и текста</p>
              </div>
              <Download size={18} className="card-action-icon" />
            </button>

            <label className="export-card import-card">
              <div className="export-card-icon">
                <Upload size={24} />
              </div>
              <div className="export-card-info">
                <h4>Восстановить из JSON</h4>
                <p>Загрузить ранее экспортированную резервную копию</p>
              </div>
              <input
                type="file"
                accept=".json"
                onChange={handleImportJson}
                className="hidden-file-input"
              />
            </label>

            <button className="export-card" onClick={() => window.print()}>
              <div className="export-card-icon">
                <Printer size={24} />
              </div>
              <div className="export-card-info">
                <h4>Печать / PDF</h4>
                <p>Вывод страницы на печать или сохранение в PDF через браузер</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
