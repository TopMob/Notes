import React from 'react';
import { X, Image, FileJson, FileText, Download, Upload } from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { drawStrokeToCanvas } from '../../canvas/stroke/freehand';
import { drawShapeToCanvas } from '../../canvas/stroke/shapes';
import { getDB } from '../../db/idb';

export const ExportModal: React.FC = () => {
  const { isExportOpen, setExportOpen } = useUiStore();
  const { strokes, shapes, textBlocks, background, textBlockHeights } = useCanvasStore();
  const { activePage } = useNotebookStore();

  if (!isExportOpen) return null;

  // Экспорт страницы в PNG
  const handleExportPng = async () => {
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
      const h = textBlockHeights[tb.id] || tb.height || 100;
      minX = Math.min(minX, tb.x);
      minY = Math.min(minY, tb.y);
      maxX = Math.max(maxX, tb.x + tb.width);
      maxY = Math.max(maxY, tb.y + h);
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

    // 1. Белый базовый фон
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Смещение начала координат
    ctx.translate(padding - minX, padding - minY);

    // 2. Отрисовка фонового паттерна (линейка / клетка)
    if (background === 'ruled') {
      const lineSpacing = 32;
      const startY = Math.floor((minY - padding) / lineSpacing) * lineSpacing;
      const endY = Math.ceil((maxY + padding) / lineSpacing) * lineSpacing;

      ctx.save();
      ctx.strokeStyle = 'rgba(0, 120, 212, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = startY; y <= endY; y += lineSpacing) {
        ctx.moveTo(minX - padding, y);
        ctx.lineTo(maxX + padding, y);
      }
      ctx.stroke();

      // Красная вертикальная линия полей
      ctx.strokeStyle = 'rgba(216, 59, 1, 0.25)';
      ctx.beginPath();
      ctx.moveTo(0, minY - padding);
      ctx.lineTo(0, maxY + padding);
      ctx.stroke();
      ctx.restore();
    } else if (background === 'grid-small' || background === 'grid-large') {
      const gridSize = background === 'grid-small' ? 24 : 40;
      const startX = Math.floor((minX - padding) / gridSize) * gridSize;
      const endX = Math.ceil((maxX + padding) / gridSize) * gridSize;
      const startY = Math.floor((minY - padding) / gridSize) * gridSize;
      const endY = Math.ceil((maxY + padding) / gridSize) * gridSize;

      ctx.save();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startX; x <= endX; x += gridSize) {
        ctx.moveTo(x, minY - padding);
        ctx.lineTo(x, maxY + padding);
      }
      for (let y = startY; y <= endY; y += gridSize) {
        ctx.moveTo(minX - padding, y);
        ctx.lineTo(maxX + padding, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 3. Отрисовка маркеров
    for (const s of strokes) {
      if (s.tool === 'highlighter') drawStrokeToCanvas(ctx, s);
    }

    // 4. Отрисовка перьевых штрихов и фигур в хронологическом порядке
    type VisualItem = { item: typeof strokes[0] | typeof shapes[0]; time: number; isStroke: boolean };
    const items: VisualItem[] = [
      ...strokes.filter((s) => s.tool !== 'highlighter').map((s) => ({ item: s, time: s.createdAt || 0, isStroke: true })),
      ...shapes.map((sh) => ({ item: sh, time: sh.createdAt || (parseInt(sh.id.replace('shape-', ''), 10) || 0), isStroke: false })),
    ];
    items.sort((a, b) => a.time - b.time);

    for (const entry of items) {
      if (entry.isStroke) {
        drawStrokeToCanvas(ctx, entry.item as typeof strokes[0]);
      } else {
        drawShapeToCanvas(ctx, entry.item as typeof shapes[0]);
      }
    }

    // 5. Отрисовка текстовых блоков с поддержкой таблиц, KaTeX и стилей через foreignObject
    for (const tb of textBlocks) {
      const blockWidth = tb.width || 300;
      const blockHeight = textBlockHeights[tb.id] || tb.height || 120;

      const svgDoc = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${blockWidth}" height="${blockHeight}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; line-height: 1.5; color: #201f1e; word-break: break-word;">
              <style>
                .onenote-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 0.95em; border: 1px solid #edebe9; table-layout: fixed; }
                .onenote-table th { background: #f3f2f1; font-weight: 600; padding: 6px 10px; border: 1px solid #edebe9; text-align: left; }
                .onenote-table td { padding: 6px 10px; border: 1px solid #edebe9; }
                .onenote-callout { margin: 8px 0; padding: 8px 12px; background: rgba(119, 25, 170, 0.06); border-left: 4px solid #7719aa; font-size: 0.95em; border-radius: 0 4px 4px 0; }
                .katex { font-size: 1.1em; line-height: 1.2; }
                p { margin: 0 0 6px 0; }
                ul, ol { margin: 4px 0; padding-left: 20px; }
              </style>
              ${tb.contentHTML}
            </div>
          </foreignObject>
        </svg>
      `;

      try {
        const img = new window.Image();
        const svgBlob = new Blob([svgDoc], { type: 'image/svg+xml;charset=utf-8' });
        const blobUrl = URL.createObjectURL(svgBlob);

        await new Promise<void>((resolve) => {
          img.onload = () => {
            ctx.drawImage(img, tb.x, tb.y);
            URL.revokeObjectURL(blobUrl);
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            // Запасной вариант при сбое: рендерим текст
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = tb.contentHTML;
            const lines = tempDiv.innerText.split('\n');
            let lineY = tb.y + 20;
            ctx.font = '16px Inter, sans-serif';
            ctx.fillStyle = '#201f1e';
            for (const line of lines) {
              if (line.trim()) {
                ctx.fillText(line.trim(), tb.x, lineY);
                lineY += 24;
              }
            }
            resolve();
          };
          img.src = blobUrl;
        });
      } catch {
        // ignore
      }
    }

    const dataUrl = offscreen.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `OneNote_${activePage?.title || 'Note'}.png`;
    a.click();
    setExportOpen(false);
  };

  // Экспорт страницы в PDF (через системный диалог PDF печати)
  const handleExportPdf = () => {
    setExportOpen(false);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  // Экспорт всей базы в сжатый JSON-бэкап (Gzip .json.gz)
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

    const jsonString = JSON.stringify(data);
    let blob: Blob;
    let fileName = `onenote_backup_${new Date().toISOString().slice(0, 10)}.json.gz`;

    if (typeof CompressionStream !== 'undefined') {
      const stream = new Blob([jsonString]).stream().pipeThrough(new CompressionStream('gzip'));
      blob = await new Response(stream).blob();
    } else {
      blob = new Blob([jsonString], { type: 'application/json' });
      fileName = `onenote_backup_${new Date().toISOString().slice(0, 10)}.json`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  // Импорт из JSON / JSON.GZ бэкапа
  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let jsonStr = '';
      if (file.name.endsWith('.gz') || file.type.includes('gzip')) {
        const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
        jsonStr = await new Response(stream).text();
      } else {
        jsonStr = await file.text();
      }

      const json = JSON.parse(jsonStr);
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

  return (
    <div className="modal-backdrop" onClick={() => setExportOpen(false)}>
      <div className="modal-content export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Файл / Экспорт данных</h3>
          <button className="modal-close-btn" onClick={() => setExportOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="export-options-grid">
            {/* 1. PNG */}
            <button className="export-card" onClick={handleExportPng}>
              <div className="export-card-icon">
                <Image size={24} />
              </div>
              <div className="export-card-info">
                <h4>Экспорт в PNG</h4>
                <p>Сохранить текущую страницу как изображение высокой чёткости</p>
              </div>
              <Download size={18} className="card-action-icon" />
            </button>

            {/* 2. PDF */}
            <button className="export-card" onClick={handleExportPdf}>
              <div className="export-card-icon">
                <FileText size={24} />
              </div>
              <div className="export-card-info">
                <h4>Экспорт в PDF</h4>
                <p>Сохранение страницы в формате PDF для документов и отправки</p>
              </div>
              <Download size={18} className="card-action-icon" />
            </button>

            {/* 3. JSON Бэкап */}
            <button className="export-card" onClick={handleExportJson}>
              <div className="export-card-icon">
                <FileJson size={24} />
              </div>
              <div className="export-card-info">
                <h4>Резервная копия (JSON)</h4>
                <p>Полный бэкап всех блокнотов, разделов, штрихов и заметок</p>
              </div>
              <Download size={18} className="card-action-icon" />
            </button>

            {/* 4. Восстановление из JSON */}
            <label className="export-card import-card">
              <div className="export-card-icon">
                <Upload size={24} />
              </div>
              <div className="export-card-info">
                <h4>Восстановить из JSON</h4>
                <p>Загрузить ранее экспортированную резервную копию блокнотов</p>
              </div>
              <input
                type="file"
                accept=".json,.gz,.json.gz,application/json,application/gzip"
                onChange={handleImportJson}
                className="hidden-file-input"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
