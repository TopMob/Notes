import { create } from 'zustand';
import {
  ToolType,
  ShapeType,
  Camera,
  CanvasBackground,
  Stroke,
  ShapeObject,
} from '../types/canvas';
import { TextBlock } from '../types/textblock';
import {
  savePageStrokes,
  savePageShapes,
  savePageTextBlocks,
  updatePageMetadata,
  loadPageData,
} from '../db/storage';
import { SpatialIndex } from '../canvas/engine/SpatialIndex';

interface CanvasState {
  // Инструменты
  activeTool: ToolType;
  penColor: string;
  penWidth: number;
  highlighterColor: string;
  highlighterWidth: number;
  shapeType: ShapeType;
  shapeColor: string;
  shapeWidth: number;

  // Камера и фон текущей страницы
  camera: Camera;
  background: CanvasBackground;

  // Контент страницы
  currentPageId: string | null;
  strokes: Stroke[];
  shapes: ShapeObject[];
  textBlocks: TextBlock[];

  // Выделение (Lasso / Cursor)
  selectedStrokeIds: string[];
  selectedShapeIds: string[];
  selectedTextBlockIds: string[];

  // Пространственный индекс (Quadtree)
  spatialIndex: SpatialIndex;

  // Статус сохранения
  saveStatus: 'saved' | 'saving';

  // Действия
  setActiveTool: (tool: ToolType) => void;
  setPenColor: (color: string) => void;
  setPenWidth: (width: number) => void;
  setHighlighterColor: (color: string) => void;
  setHighlighterWidth: (width: number) => void;
  setShapeType: (type: ShapeType) => void;
  setShapeColor: (color: string) => void;
  setShapeWidth: (width: number) => void;

  setCamera: (camera: Camera | ((prev: Camera) => Camera)) => void;
  setBackground: (bg: CanvasBackground) => void;

  loadPage: (pageId: string, initialCamera?: Camera, initialBg?: CanvasBackground) => Promise<void>;

  addStroke: (stroke: Stroke) => void;
  removeStroke: (strokeId: string) => void;
  deleteStrokes: (strokeIds: string[]) => void;

  addShape: (shape: ShapeObject) => void;
  removeShape: (shapeId: string) => void;

  addTextBlock: (block: TextBlock) => void;
  updateTextBlock: (id: string, updates: Partial<TextBlock>) => void;
  removeTextBlock: (id: string) => void;

  setSelection: (strokeIds: string[], shapeIds: string[], textBlockIds: string[]) => void;
  clearSelection: () => void;
  moveSelectedItems: (dx: number, dy: number) => void;
  deleteSelectedItems: () => void;

  triggerAutosave: () => void;
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export const useCanvasStore = create<CanvasState>((set, get) => {
  const spatialIndex = new SpatialIndex();

  const scheduleSave = () => {
    set({ saveStatus: 'saving' });
    if (saveTimeout) clearTimeout(saveTimeout);

    saveTimeout = setTimeout(async () => {
      const { currentPageId, strokes, shapes, textBlocks, camera, background } = get();
      if (!currentPageId) return;

      try {
        await Promise.all([
          savePageStrokes(currentPageId, strokes),
          savePageShapes(currentPageId, shapes),
          savePageTextBlocks(currentPageId, textBlocks),
          updatePageMetadata(currentPageId, { camera, background }),
        ]);
        set({ saveStatus: 'saved' });
      } catch (err) {
        console.error('Ошибка сохранения страницы в IndexedDB:', err);
        set({ saveStatus: 'saved' });
      }
    }, 400);
  };

  return {
    activeTool: 'pen',
    penColor: '#201f1e',
    penWidth: 3,
    highlighterColor: '#fff176', // Soft sunny highlighter yellow
    highlighterWidth: 20,
    shapeType: 'rect',
    shapeColor: '#201f1e',
    shapeWidth: 2,

    camera: { x: 260, y: 150, zoom: 1 },
    background: 'plain',

    currentPageId: 'page-17-09',
    strokes: [],
    shapes: [],
    textBlocks: [],

    selectedStrokeIds: [],
    selectedShapeIds: [],
    selectedTextBlockIds: [],

    spatialIndex,
    saveStatus: 'saved',

    setActiveTool: (tool) => set({ activeTool: tool }),
    setPenColor: (color) => set({ penColor: color }),
    setPenWidth: (width) => set({ penWidth: width }),
    setHighlighterColor: (color) => set({ highlighterColor: color }),
    setHighlighterWidth: (width) => set({ highlighterWidth: width }),
    setShapeType: (shapeType) => set({ shapeType }),
    setShapeColor: (shapeColor) => set({ shapeColor }),
    setShapeWidth: (shapeWidth) => set({ shapeWidth }),

    setCamera: (cameraOrFn) => {
      set((state) => {
        const newCamera = typeof cameraOrFn === 'function' ? cameraOrFn(state.camera) : cameraOrFn;
        return { camera: newCamera };
      });
      scheduleSave();
    },

    setBackground: (background) => {
      set({ background });
      scheduleSave();
    },

    loadPage: async (pageId: string, initialCamera?: Camera, initialBg?: CanvasBackground) => {
      set({ currentPageId: pageId });
      const { strokes, shapes, textBlocks } = await loadPageData(pageId);

      spatialIndex.rebuild([...strokes, ...shapes]);

      set({
        strokes,
        shapes,
        textBlocks,
        selectedStrokeIds: [],
        selectedShapeIds: [],
        selectedTextBlockIds: [],
        camera: initialCamera ?? { x: 260, y: 150, zoom: 1 },
        background: initialBg ?? 'plain',
        saveStatus: 'saved',
      });
    },

    addStroke: (stroke) => {
      spatialIndex.insert(stroke);
      set((state) => ({ strokes: [...state.strokes, stroke] }));
      scheduleSave();
    },

    removeStroke: (strokeId) => {
      set((state) => {
        const nextStrokes = state.strokes.filter((s) => s.id !== strokeId);
        spatialIndex.rebuild([...nextStrokes, ...state.shapes]);
        return { strokes: nextStrokes };
      });
      scheduleSave();
    },

    deleteStrokes: (strokeIds) => {
      if (strokeIds.length === 0) return;
      const idsSet = new Set(strokeIds);
      set((state) => {
        const nextStrokes = state.strokes.filter((s) => !idsSet.has(s.id));
        spatialIndex.rebuild([...nextStrokes, ...state.shapes]);
        return { strokes: nextStrokes };
      });
      scheduleSave();
    },

    addShape: (shape) => {
      spatialIndex.insert(shape);
      set((state) => ({ shapes: [...state.shapes, shape] }));
      scheduleSave();
    },

    removeShape: (shapeId) => {
      set((state) => {
        const nextShapes = state.shapes.filter((s) => s.id !== shapeId);
        spatialIndex.rebuild([...state.strokes, ...nextShapes]);
        return { shapes: nextShapes };
      });
      scheduleSave();
    },

    addTextBlock: (block) => {
      set((state) => ({ textBlocks: [...state.textBlocks, block] }));
      scheduleSave();
    },

    updateTextBlock: (id, updates) => {
      set((state) => ({
        textBlocks: state.textBlocks.map((b) => (b.id === id ? { ...b, ...updates } : b)),
      }));
      scheduleSave();
    },

    removeTextBlock: (id) => {
      set((state) => ({
        textBlocks: state.textBlocks.filter((b) => b.id !== id),
      }));
      scheduleSave();
    },

    setSelection: (strokeIds, shapeIds, textBlockIds) => {
      set({
        selectedStrokeIds: strokeIds,
        selectedShapeIds: shapeIds,
        selectedTextBlockIds: textBlockIds,
      });
    },

    clearSelection: () => {
      set({
        selectedStrokeIds: [],
        selectedShapeIds: [],
        selectedTextBlockIds: [],
      });
    },

    moveSelectedItems: (dx, dy) => {
      const { selectedStrokeIds, selectedShapeIds, selectedTextBlockIds } = get();
      if (!selectedStrokeIds.length && !selectedShapeIds.length && !selectedTextBlockIds.length) return;

      const strokeSet = new Set(selectedStrokeIds);
      const shapeSet = new Set(selectedShapeIds);
      const tbSet = new Set(selectedTextBlockIds);

      set((state) => {
        const nextStrokes = state.strokes.map((s) => {
          if (!strokeSet.has(s.id)) return s;
          const updatedPoints = s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
          return {
            ...s,
            points: updatedPoints,
            bounds: {
              minX: s.bounds.minX + dx,
              minY: s.bounds.minY + dy,
              maxX: s.bounds.maxX + dx,
              maxY: s.bounds.maxY + dy,
            },
          };
        });

        const nextShapes = state.shapes.map((sh) => {
          if (!shapeSet.has(sh.id)) return sh;
          return {
            ...sh,
            anchor: { ...sh.anchor, x: sh.anchor.x + dx, y: sh.anchor.y + dy },
            end: { ...sh.end, x: sh.end.x + dx, y: sh.end.y + dy },
            bounds: {
              minX: sh.bounds.minX + dx,
              minY: sh.bounds.minY + dy,
              maxX: sh.bounds.maxX + dx,
              maxY: sh.bounds.maxY + dy,
            },
          };
        });

        const nextTextBlocks = state.textBlocks.map((tb) => {
          if (!tbSet.has(tb.id)) return tb;
          return { ...tb, x: tb.x + dx, y: tb.y + dy };
        });

        spatialIndex.rebuild([...nextStrokes, ...nextShapes]);

        return {
          strokes: nextStrokes,
          shapes: nextShapes,
          textBlocks: nextTextBlocks,
        };
      });

      scheduleSave();
    },

    deleteSelectedItems: () => {
      const { selectedStrokeIds, selectedShapeIds, selectedTextBlockIds } = get();
      const strokeSet = new Set(selectedStrokeIds);
      const shapeSet = new Set(selectedShapeIds);
      const tbSet = new Set(selectedTextBlockIds);

      set((state) => {
        const nextStrokes = state.strokes.filter((s) => !strokeSet.has(s.id));
        const nextShapes = state.shapes.filter((sh) => !shapeSet.has(sh.id));
        const nextTextBlocks = state.textBlocks.filter((tb) => !tbSet.has(tb.id));
        spatialIndex.rebuild([...nextStrokes, ...nextShapes]);

        return {
          strokes: nextStrokes,
          shapes: nextShapes,
          textBlocks: nextTextBlocks,
          selectedStrokeIds: [],
          selectedShapeIds: [],
          selectedTextBlockIds: [],
        };
      });

      scheduleSave();
    },

    triggerAutosave: scheduleSave,
  };
});
