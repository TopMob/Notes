import { useShallow } from 'zustand/react/shallow';
import React, { useState } from 'react';
import { assetManager } from '../../services/assets/assetManager';
import { X, Image, FileJson, FileText, Download, Upload } from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { drawStrokeToCanvas } from '../../canvas/stroke/freehand';
import { drawShapeToCanvas } from '../../canvas/stroke/shapes';

export const ExportModal: React.FC = () => {
  const { isExportOpen, setExportOpen } = useUiStore();
  const { strokes, shapes, textBlocks, background, textBlockHeights } = useCanvasStore(useShallow(state => ({
    strokes: state.strokes,
    shapes: state.shapes,
    textBlocks: state.textBlocks,
    background: state.background,
    textBlockHeights: state.textBlockHeights,
  })));
  const { activePage } = useNotebookStore();

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!isExportOpen) return null;

  // Экспорт страницы в PNG
  const handleExportPng = async () => {
    if (isExporting) return;
    setIsExporting(true); setExportError(null);
    const releases: (() => void)[] = [];
    const offscreen = document.createElement('canvas');
    try {
      const { planPngTiles, canvasPng, zipFiles } = await import('../../utils/pngExport');
      for (const tb of textBlocks) {
        const template = document.createElement('template'); template.innerHTML = tb.contentHTML;
        for (const img of template.content.querySelectorAll('img[data-asset-id]')) {
          const id = img.getAttribute('data-asset-id'); if (id) releases.push(assetManager.retain(id));
        }
      }
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

      const tiles = planPngTiles(width, height);
      const files: { name: string; blob: Blob }[] = [];
      for (const [index, tile] of tiles.entries()) {
        const tileMinX = minX - padding + tile.x, tileMinY = minY - padding + tile.y;
        const tileMaxX = tileMinX + tile.width, tileMaxY = tileMinY + tile.height;
        offscreen.width = tile.width * 2; // Retina 2x
        offscreen.height = tile.height * 2;
        const ctx = offscreen.getContext('2d');
        if (!ctx) throw new Error('Браузер не смог выделить холст для экспорта.');

        ctx.scale(2, 2);

        // 1. Белый базовый фон
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tile.width, tile.height);

        // Смещение начала координат
        ctx.translate(-tileMinX, -tileMinY);

        // 2. Отрисовка фонового паттерна (линейка / клетка)
        if (background === 'ruled') {
          const lineSpacing = 32;
          const startY = Math.floor(tileMinY / lineSpacing) * lineSpacing;
          const endY = Math.ceil(tileMaxY / lineSpacing) * lineSpacing;

          ctx.save();
          ctx.strokeStyle = 'rgba(0, 120, 212, 0.2)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let y = startY; y <= endY; y += lineSpacing) {
            ctx.moveTo(tileMinX, y);
            ctx.lineTo(tileMaxX, y);
          }
          ctx.stroke();

          // Красная вертикальная линия полей
          ctx.strokeStyle = 'rgba(216, 59, 1, 0.25)';
          ctx.beginPath();
          ctx.moveTo(0, tileMinY);
          ctx.lineTo(0, tileMaxY);
          ctx.stroke();
          ctx.restore();
        } else if (background === 'grid-small' || background === 'grid-large') {
          const gridSize = background === 'grid-small' ? 20 : 40;
          const startX = Math.floor(tileMinX / gridSize) * gridSize;
          const endX = Math.ceil(tileMaxX / gridSize) * gridSize;
          const startY = Math.floor(tileMinY / gridSize) * gridSize;
          const endY = Math.ceil(tileMaxY / gridSize) * gridSize;

          ctx.save();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let x = startX; x <= endX; x += gridSize) {
            ctx.moveTo(x, tileMinY);
            ctx.lineTo(x, tileMaxY);
          }
          for (let y = startY; y <= endY; y += gridSize) {
            ctx.moveTo(tileMinX, y);
            ctx.lineTo(tileMaxX, y);
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
          if (tb.x > tileMaxX || tb.x + blockWidth < tileMinX || tb.y > tileMaxY || tb.y + blockHeight < tileMinY) continue;
          const template = document.createElement('template'); template.innerHTML = tb.contentHTML;
          for (const image of template.content.querySelectorAll<HTMLImageElement>('img[data-asset-id]')) {
            const id = image.getAttribute('data-asset-id')!;
            const blob = await assetManager.getBlob(id);
            if (!blob) throw new Error('Не удалось загрузить изображение для экспорта.');
            // SVG-as-image cannot load external/blob subresources. Embed original
            // bytes, without resizing or lossy recompression, for this export only.
            image.src = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('Не удалось прочитать изображение для экспорта.'));
              reader.readAsDataURL(blob);
            });
          }
          const markup = [...template.content.childNodes].map(node => new XMLSerializer().serializeToString(node)).join('');

          const svgDoc = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${tile.width}" height="${tile.height}" viewBox="${tileMinX - tb.x} ${tileMinY - tb.y} ${tile.width} ${tile.height}">
              <foreignObject width="${blockWidth}" height="${blockHeight}">
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
                  ${markup}
                </div>
              </foreignObject>
            </svg>
          `;

          const img = new window.Image();
          await new Promise<void>((resolve, reject) => {
              img.onload = () => { try { ctx.drawImage(img, tileMinX, tileMinY); resolve(); } catch (error) { reject(error); } };
              img.onerror = () => reject(new Error('Не удалось отрисовать текст для экспорта.'));
              // A data URL keeps foreignObject origin-clean in Chromium.
              img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgDoc)}`;
          });
        }
        files.push({ name: `page-${String(index + 1).padStart(3, '0')}.png`, blob: await canvasPng(offscreen) });
        // Release the bitmap before rendering another tile; PNG blobs stay compressed.
        offscreen.width = 0; offscreen.height = 0;
      }
      if (files.length > 1) files.push({ name: 'layout.json', blob: new Blob([JSON.stringify({ width, height, scale: 2, origin: {x:minX-padding,y:minY-padding}, tiles }, null, 2)], {type:'application/json'}) });
      const blob = files.length === 1 ? files[0].blob : await zipFiles(files);
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a'); a.href = url;
        a.download = `OneNote_${activePage?.title || 'Note'}.${files.length === 1 ? 'png' : 'zip'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch (error) { URL.revokeObjectURL(url); throw error; }
      setExportOpen(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Не удалось экспортировать страницу.');
    } finally {
      offscreen.width = 0; offscreen.height = 0;
      releases.forEach(release => release());
      setIsExporting(false);
    }
  };

  // Экспорт страницы в PDF (через системный диалог PDF печати)
  const handleExportPdf = () => {
    setExportOpen(false);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  // Экспорт всей базы в JSON-бэкап
  const handleExportJson = async () => {
    try {
      await useCanvasStore.getState().flushAllSaves();
      const { exportFullBackup } = await import('../../db/storage');
      const jsonString = await exportFullBackup();
      const blob = new Blob([jsonString], { type: 'application/json' });
      const fileName = `onenote_backup_${new Date().toISOString().slice(0, 10)}.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (err: any) {
      alert('Ошибка при создании бэкапа: ' + err.message);
    }
  };

  // Импорт из JSON бэкапа
  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { importFullBackup } = await import('../../db/storage');
      const jsonStr = await file.text();
      const res = await importFullBackup(jsonStr);
      alert(res.stats + ' Приложение будет перезагружено.');
      window.location.reload();
    } catch (err: any) {
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

        <div className="modal-body" aria-busy={isExporting}>
          {exportError && <p role="alert">{exportError}</p>}
          <div className="export-options-grid">
            {/* 1. PNG */}
            <button className="export-card" disabled={isExporting} onClick={handleExportPng}>
              <div className="export-card-icon">
                <Image size={24} />
              </div>
              <div className="export-card-info">
                <h4>Экспорт в PNG</h4>
                <p>Высокая чёткость 2×. Большие страницы — архив PNG без снижения качества.</p>
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
                <h4>Копия заметок (JSON)</h4>
                <p>Блокноты, текст и рисунки. Файлы изображений в этот формат не входят.</p>
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
                accept=".json,application/json"
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
