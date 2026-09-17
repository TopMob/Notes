import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useCanvasStore } from '../../store/useCanvasStore';
import { Viewport } from '../../canvas/engine/Viewport';
import { BackgroundLayer } from './BackgroundLayer';
import { TextOverlay } from '../text/TextOverlay';
import { drawStrokeToCanvas } from '../../canvas/stroke/freehand';
import { drawShapeToCanvas, snapShapeEndPoint, computeShapeBounds } from '../../canvas/stroke/shapes';
import { simplifyDouglasPeucker } from '../../canvas/stroke/simplify';
import { Point, Stroke, ShapeObject, ViewportSize } from '../../types/canvas';
import { globalCommandStack } from '../../canvas/history/CommandStack';
import { aabbIntersects } from '../../canvas/engine/SpatialIndex';

export const InfiniteCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const {
    activeTool,
    penColor,
    penWidth,
    highlighterColor,
    highlighterWidth,
    shapeType,
    shapeColor,
    shapeWidth,
    camera,
    setCamera,
    background,
    currentPageId,
    strokes,
    shapes,
    textBlocks,
    addStroke,
    deleteStrokes,
    addShape,
    spatialIndex,
    selectedStrokeIds,
    selectedShapeIds,
    selectedTextBlockIds,
    setSelection,
    moveSelectedItems,
    addTextBlock,
  } = useCanvasStore();

  const [viewportSize, setViewportSize] = useState<ViewportSize>({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);

  // Состояние активного рисования
  const isPointerDownRef = useRef(false);
  const strokePointsRef = useRef<Point[]>([]);
  const shapeAnchorRef = useRef<Point | null>(null);
  const lassoPointsRef = useRef<Point[]>([]);
  const panStartRef = useRef<{ clientX: number; clientY: number; camX: number; camY: number } | null>(null);
  const isSpacePressedRef = useRef(false);
  const moveDragStartRef = useRef<{ clientX: number; clientY: number } | null>(null);

  // Resize listener
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setViewportSize({ w: Math.max(100, rect.width), h: Math.max(100, rect.height) });
      }
      setDpr(window.devicePixelRatio || 1);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Горячие клавиши (Space для Pan, Ctrl+Z для Undo, Del для удаления)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      if (e.code === 'Space' && !e.repeat) {
        isSpacePressedRef.current = true;
        if (containerRef.current) containerRef.current.style.cursor = 'grab';
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          globalCommandStack.redo();
        } else {
          globalCommandStack.undo();
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        globalCommandStack.redo();
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        useCanvasStore.getState().deleteSelectedItems();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        if (containerRef.current) containerRef.current.style.cursor = '';
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Отрисовка постоянного слоя (content-canvas)
  const renderContentLayer = useCallback(() => {
    const canvas = contentCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    Viewport.applyTransform(ctx, camera, viewportSize, dpr);

    const visibleRange = Viewport.getVisibleWorldBounds(camera, viewportSize, 0.2);

    // 1. Маркеры (рисуются первыми в режиме multiply)
    for (const stroke of strokes) {
      if (stroke.tool === 'highlighter' && aabbIntersects(stroke.bounds, visibleRange)) {
        drawStrokeToCanvas(ctx, stroke);
      }
    }

    // 2. Обычные перьевые штрихи
    for (const stroke of strokes) {
      if (stroke.tool === 'pen' && aabbIntersects(stroke.bounds, visibleRange)) {
        drawStrokeToCanvas(ctx, stroke);
      }
    }

    // 3. Фигуры
    for (const shape of shapes) {
      if (aabbIntersects(shape.bounds, visibleRange)) {
        drawShapeToCanvas(ctx, shape);
      }
    }
  }, [camera, viewportSize, dpr, strokes, shapes]);

  // Запуск перерисовки content-canvas при изменении штрихов/камеры
  useEffect(() => {
    renderContentLayer();
  }, [renderContentLayer, strokes, shapes]);

  // Отрисовка слоя выделения (рамка вокруг выбранных объектов)
  useEffect(() => {
    const canvas = selectionCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hasSelection =
      selectedStrokeIds.length > 0 ||
      selectedShapeIds.length > 0 ||
      selectedTextBlockIds.length > 0;

    if (!hasSelection) return;

    Viewport.applyTransform(ctx, camera, viewportSize, dpr);

    // Находим общий bounding box для выделенных элементов
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const strokeMap = new Map(strokes.map((s) => [s.id, s]));
    for (const id of selectedStrokeIds) {
      const s = strokeMap.get(id);
      if (s) {
        minX = Math.min(minX, s.bounds.minX);
        minY = Math.min(minY, s.bounds.minY);
        maxX = Math.max(maxX, s.bounds.maxX);
        maxY = Math.max(maxY, s.bounds.maxY);
      }
    }

    const shapeMap = new Map(shapes.map((sh) => [sh.id, sh]));
    for (const id of selectedShapeIds) {
      const sh = shapeMap.get(id);
      if (sh) {
        minX = Math.min(minX, sh.bounds.minX);
        minY = Math.min(minY, sh.bounds.minY);
        maxX = Math.max(maxX, sh.bounds.maxX);
        maxY = Math.max(maxY, sh.bounds.maxY);
      }
    }

    const tbMap = new Map(textBlocks.map((tb) => [tb.id, tb]));
    for (const id of selectedTextBlockIds) {
      const tb = tbMap.get(id);
      if (tb) {
        minX = Math.min(minX, tb.x);
        minY = Math.min(minY, tb.y);
        maxX = Math.max(maxX, tb.x + tb.width);
        maxY = Math.max(maxY, tb.y + 100);
      }
    }

    if (minX !== Infinity) {
      const pad = 8;
      ctx.save();
      ctx.strokeStyle = '#7719aa';
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.setLineDash([5 / camera.zoom, 5 / camera.zoom]);
      ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);

      // Ручки по углам
      const handleSize = 7 / camera.zoom;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#7719aa';
      ctx.setLineDash([]);
      const corners = [
        [minX - pad, minY - pad],
        [maxX + pad, minY - pad],
        [minX - pad, maxY + pad],
        [maxX + pad, maxY + pad],
      ];
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
      }
      ctx.restore();
    }
  }, [
    selectedStrokeIds,
    selectedShapeIds,
    selectedTextBlockIds,
    strokes,
    shapes,
    textBlocks,
    camera,
    viewportSize,
    dpr,
  ]);

  // Обработка жестов колеса мыши / трекпада (Zoom и Pan)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Zoom относительно курсора
      const rect = containerRef.current?.getBoundingClientRect();
      const screenPoint = {
        x: e.clientX - (rect?.left || 0),
        y: e.clientY - (rect?.top || 0),
      };
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newCam = Viewport.zoomAtPoint(camera, screenPoint, factor, viewportSize);
      setCamera(newCam);
    } else {
      // Pan холста
      setCamera((prev) => ({
        ...prev,
        x: prev.x + e.deltaX / prev.zoom,
        y: prev.y + e.deltaY / prev.zoom,
      }));
    }
  };

  // Поинтер события для рисования
  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPos = Viewport.screenToWorld(screenPos, camera, viewportSize);

    // 1. Pan режим (Пробел или средняя кнопка мыши)
    if (isSpacePressedRef.current || e.button === 1 || activeTool === 'pan') {
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        camX: camera.x,
        camY: camera.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return; // Только ЛКМ для рисования

    // 2. Режим курсора: перемещение выделенного или снятие
    if (activeTool === 'cursor') {
      const hasSelection =
        selectedStrokeIds.length > 0 ||
        selectedShapeIds.length > 0 ||
        selectedTextBlockIds.length > 0;

      if (hasSelection) {
        moveDragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
      return;
    }

    // 3. Рисование пером / маркером
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      isPointerDownRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const activeCanvas = activeCanvasRef.current;
      if (activeCanvas) {
        const ctx = activeCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
          Viewport.applyTransform(ctx, camera, viewportSize, dpr);
        }
      }

      const pt: Point = {
        x: worldPos.x,
        y: worldPos.y,
        pressure: e.pressure > 0 ? e.pressure : 0.5,
        t: Date.now(),
      };
      strokePointsRef.current = [pt];

      if (activeCanvas) {
        const ctx = activeCanvas.getContext('2d');
        if (ctx) {
          drawStrokeToCanvas(ctx, {
            id: 'temp',
            pageId: currentPageId || '',
            tool: activeTool,
            points: [pt],
            color: activeTool === 'pen' ? penColor : highlighterColor,
            baseWidth: activeTool === 'pen' ? penWidth : highlighterWidth,
            opacity: activeTool === 'pen' ? 1.0 : 0.35,
            blendMode: activeTool === 'pen' ? 'source-over' : 'multiply',
            bounds: Viewport.computeBounds([pt]),
            createdAt: Date.now(),
          });
        }
      }
      return;
    }

    // 4. Рисование фигур
    if (activeTool === 'shape') {
      isPointerDownRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const pt: Point = {
        x: worldPos.x,
        y: worldPos.y,
        pressure: 0.5,
        t: Date.now(),
      };
      shapeAnchorRef.current = pt;
      return;
    }

    // 5. Ластик
    if (activeTool === 'stroke-eraser' || activeTool === 'point-eraser') {
      isPointerDownRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      handleEraserErase(worldPos);
      return;
    }

    // 6. Лассо
    if (activeTool === 'lasso') {
      isPointerDownRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      lassoPointsRef.current = [{ ...worldPos, pressure: 0.5, t: Date.now() }];
      return;
    }
  };

  const handleEraserErase = (worldPos: { x: number; y: number }) => {
    const eraserRadius = 18 / camera.zoom;
    const searchRange = {
      minX: worldPos.x - eraserRadius,
      minY: worldPos.y - eraserRadius,
      maxX: worldPos.x + eraserRadius,
      maxY: worldPos.y + eraserRadius,
    };

    const candidates = spatialIndex.query(searchRange);
    const toDelete: string[] = [];

    for (const item of candidates) {
      if ('points' in item) {
        for (const p of item.points) {
          const dist = Math.hypot(p.x - worldPos.x, p.y - worldPos.y);
          if (dist < eraserRadius + item.baseWidth / 2) {
            toDelete.push(item.id);
            break;
          }
        }
      }
    }

    if (toDelete.length > 0) {
      deleteStrokes(toDelete);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Панорамирование
    if (panStartRef.current) {
      const dx = (e.clientX - panStartRef.current.clientX) / camera.zoom;
      const dy = (e.clientY - panStartRef.current.clientY) / camera.zoom;
      setCamera({
        ...camera,
        x: panStartRef.current.camX - dx,
        y: panStartRef.current.camY - dy,
      });
      return;
    }

    // Перемещение выделенных элементов
    if (moveDragStartRef.current) {
      const dx = (e.clientX - moveDragStartRef.current.clientX) / camera.zoom;
      const dy = (e.clientY - moveDragStartRef.current.clientY) / camera.zoom;
      moveSelectedItems(dx, dy);
      moveDragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
      return;
    }

    if (!isPointerDownRef.current) return;

    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPos = Viewport.screenToWorld(screenPos, camera, viewportSize);

    // Ластик при движении
    if (activeTool === 'stroke-eraser' || activeTool === 'point-eraser') {
      handleEraserErase(worldPos);
      return;
    }

    // Перо / Маркер
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const pt: Point = {
        x: worldPos.x,
        y: worldPos.y,
        pressure: e.pressure > 0 ? e.pressure : 0.5,
        t: Date.now(),
      };
      strokePointsRef.current.push(pt);

      // Отрисовываем текущий штрих на activeCanvas
      const activeCanvas = activeCanvasRef.current;
      if (activeCanvas) {
        const ctx = activeCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
          Viewport.applyTransform(ctx, camera, viewportSize, dpr);

          const tempStroke: Stroke = {
            id: 'temp',
            pageId: currentPageId || '',
            tool: activeTool,
            points: strokePointsRef.current,
            color: activeTool === 'pen' ? penColor : highlighterColor,
            baseWidth: activeTool === 'pen' ? penWidth : highlighterWidth,
            opacity: activeTool === 'pen' ? 1.0 : 0.35,
            blendMode: activeTool === 'pen' ? 'source-over' : 'multiply',
            bounds: Viewport.computeBounds(strokePointsRef.current),
            createdAt: Date.now(),
          };

          drawStrokeToCanvas(ctx, tempStroke);
        }
      }
      return;
    }

    // Фигуры
    if (activeTool === 'shape' && shapeAnchorRef.current) {
      const activeCanvas = activeCanvasRef.current;
      if (activeCanvas) {
        const ctx = activeCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
          Viewport.applyTransform(ctx, camera, viewportSize, dpr);

          const endPt = e.shiftKey
            ? snapShapeEndPoint(shapeAnchorRef.current, { ...worldPos, pressure: 0.5, t: 0 }, shapeType)
            : { ...worldPos, pressure: 0.5, t: 0 };

          const tempShape: ShapeObject = {
            id: 'temp-shape',
            pageId: currentPageId || '',
            type: shapeType,
            anchor: shapeAnchorRef.current,
            end: endPt,
            style: { color: shapeColor, width: shapeWidth },
            bounds: computeShapeBounds(shapeAnchorRef.current, endPt, shapeWidth),
          };

          drawShapeToCanvas(ctx, tempShape);
        }
      }
      return;
    }

    // Лассо
    if (activeTool === 'lasso') {
      lassoPointsRef.current.push({ ...worldPos, pressure: 0.5, t: Date.now() });

      const selCanvas = selectionCanvasRef.current;
      if (selCanvas) {
        const ctx = selCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, selCanvas.width, selCanvas.height);
          Viewport.applyTransform(ctx, camera, viewportSize, dpr);

          ctx.save();
          ctx.strokeStyle = '#7719aa';
          ctx.lineWidth = 1.5 / camera.zoom;
          ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
          ctx.beginPath();
          for (let i = 0; i < lassoPointsRef.current.length; i++) {
            const p = lassoPointsRef.current[i];
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
      return;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (panStartRef.current) {
      panStartRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (moveDragStartRef.current) {
      moveDragStartRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    // Завершение штриха пера / маркера
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const rawPoints = strokePointsRef.current;
      if (rawPoints.length > 0 && currentPageId) {
        const simplifiedPoints = simplifyDouglasPeucker(rawPoints, 0.8);
        const newStroke: Stroke = {
          id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          pageId: currentPageId,
          tool: activeTool,
          points: simplifiedPoints,
          color: activeTool === 'pen' ? penColor : highlighterColor,
          baseWidth: activeTool === 'pen' ? penWidth : highlighterWidth,
          opacity: activeTool === 'pen' ? 1.0 : 0.35,
          blendMode: activeTool === 'pen' ? 'source-over' : 'multiply',
          bounds: Viewport.computeBounds(simplifiedPoints),
          createdAt: Date.now(),
        };

        addStroke(newStroke);
      }

      strokePointsRef.current = [];
      const activeCanvas = activeCanvasRef.current;
      if (activeCanvas) {
        const ctx = activeCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
        }
      }
      return;
    }

    // Завершение фигуры
    if (activeTool === 'shape' && shapeAnchorRef.current && currentPageId) {
      const rect = containerRef.current?.getBoundingClientRect();
      const screenPos = { x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) };
      const worldPos = Viewport.screenToWorld(screenPos, camera, viewportSize);

      const endPt = e.shiftKey
        ? snapShapeEndPoint(shapeAnchorRef.current, { ...worldPos, pressure: 0.5, t: 0 }, shapeType)
        : { ...worldPos, pressure: 0.5, t: 0 };

      const newShape: ShapeObject = {
        id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pageId: currentPageId,
        type: shapeType,
        anchor: shapeAnchorRef.current,
        end: endPt,
        style: { color: shapeColor, width: shapeWidth },
        bounds: computeShapeBounds(shapeAnchorRef.current, endPt, shapeWidth),
      };

      addShape(newShape);
      shapeAnchorRef.current = null;

      const activeCanvas = activeCanvasRef.current;
      if (activeCanvas) {
        const ctx = activeCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
        }
      }
      return;
    }

    // Завершение лассо: вычисляем выделенные элементы
    if (activeTool === 'lasso') {
      const lassoPts = lassoPointsRef.current;
      if (lassoPts.length >= 3) {
        const lassoBounds = Viewport.computeBounds(lassoPts);
        const candidates = spatialIndex.query(lassoBounds);
        const selectedStrokes: string[] = [];
        const selectedShapes: string[] = [];

        for (const item of candidates) {
          if ('points' in item) {
            // Проверяем попадание центра bbox штриха внутрь контура лассо
            const centerX = (item.bounds.minX + item.bounds.maxX) / 2;
            const centerY = (item.bounds.minY + item.bounds.maxY) / 2;
            if (isPointInPolygon({ x: centerX, y: centerY }, lassoPts)) {
              selectedStrokes.push(item.id);
            }
          } else if ('type' in item) {
            const centerX = (item.bounds.minX + item.bounds.maxX) / 2;
            const centerY = (item.bounds.minY + item.bounds.maxY) / 2;
            if (isPointInPolygon({ x: centerX, y: centerY }, lassoPts)) {
              selectedShapes.push(item.id);
            }
          }
        }

        setSelection(selectedStrokes, selectedShapes, []);
      }

      lassoPointsRef.current = [];
      const selCanvas = selectionCanvasRef.current;
      if (selCanvas) {
        const ctx = selCanvas.getContext('2d');
        ctx?.clearRect(0, 0, selCanvas.width, selCanvas.height);
      }
      return;
    }
  };

  // Двойной клик на холсте для создания заметки в точке курсора
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (activeTool !== 'cursor' && !isSpacePressedRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !currentPageId) return;

    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPos = Viewport.screenToWorld(screenPos, camera, viewportSize);

    addTextBlock({
      id: `tb-${Date.now()}`,
      pageId: currentPageId,
      x: Math.round(worldPos.x),
      y: Math.round(worldPos.y),
      width: 420,
      contentHTML: '<p>Введите текст...</p>',
      zIndex: 10,
    });
  };

  return (
    <div
      ref={containerRef}
      className={`infinite-canvas-viewport tool-${activeTool}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'relative',
        flex: 1,
        height: '100%',
        overflow: 'hidden',
        touchAction: 'none',
      }}
    >
      {/* Слой 1: Фон (клетка, линейка или чистый) */}
      <BackgroundLayer
        camera={camera}
        background={background}
        viewportSize={viewportSize}
        dpr={dpr}
      />

      {/* Слой 2: Основной контент (закоммиченные штрихи и фигуры) */}
      <canvas
        ref={contentCanvasRef}
        className="canvas-layer canvas-content"
        width={viewportSize.w * dpr}
        height={viewportSize.h * dpr}
        style={{ width: viewportSize.w, height: viewportSize.h }}
      />

      {/* Слой 3: Временный штрих в процессе рисования */}
      <canvas
        ref={activeCanvasRef}
        className="canvas-layer canvas-active"
        width={viewportSize.w * dpr}
        height={viewportSize.h * dpr}
        style={{ width: viewportSize.w, height: viewportSize.h }}
      />

      {/* Слой 4: Выделение, лассо и рамка */}
      <canvas
        ref={selectionCanvasRef}
        className="canvas-layer canvas-selection"
        width={viewportSize.w * dpr}
        height={viewportSize.h * dpr}
        style={{ width: viewportSize.w, height: viewportSize.h }}
      />

      {/* Слой 5: DOM-оверлей для текстовых контейнеров с KaTeX */}
      <TextOverlay camera={camera} viewportSize={viewportSize} />
    </div>
  );
};

/**
 * Алгоритм Ray-casting для проверки принадлежности точки полигону лассо
 */
function isPointInPolygon(point: { x: number; y: number }, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
