import { create } from 'zustand';
import {
  ToolType,
  ShapeType,
  Camera,
  CanvasBackground,
  Stroke,
  ShapeObject,
  PenCursorStyle,
  RightClickAction,
} from '../types/canvas';
import { TextBlock } from '../types/textblock';
import {
  savePageDiff,
  savePageFull,
  loadPageData,
  PageDiff,
} from '../db/storage';
import { SpatialIndex } from '../canvas/engine/SpatialIndex';
import { globalCommandStack } from '../canvas/history/CommandStack';

interface PageDirtyTracker {
  strokesPut: Map<string, Stroke>;
  strokesDelete: Set<string>;
  shapesPut: Map<string, ShapeObject>;
  shapesDelete: Set<string>;
  textBlocksPut: Map<string, TextBlock>;
  textBlocksDelete: Set<string>;
  metadata: Partial<{ camera: Camera; background: CanvasBackground }> | null;
  fullSync?: boolean;
}

const pageDirtyMap = new Map<string, PageDirtyTracker>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaves = new Map<string, Promise<void>>();

function getOrCreateDirty(pageId: string): PageDirtyTracker {
  let d = pageDirtyMap.get(pageId);
  if (!d) {
    d = {
      strokesPut: new Map(),
      strokesDelete: new Set(),
      shapesPut: new Map(),
      shapesDelete: new Set(),
      textBlocksPut: new Map(),
      textBlocksDelete: new Set(),
      metadata: null,
    };
    pageDirtyMap.set(pageId, d);
  }
  return d;
}

interface CanvasState {
  // История
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

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

  // Пространственный индекс
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
  deleteStrokesSilent: (strokeIds: string[]) => void;
  replaceStrokes: (replacements: Map<string, Stroke[]>) => void;
  replaceStrokesSilent: (replacements: Map<string, Stroke[]>) => void;

  addShape: (shape: ShapeObject) => void;
  removeShape: (shapeId: string) => void;

  addTextBlock: (block: TextBlock) => void;
  updateTextBlock: (id: string, updates: Partial<TextBlock>) => void;
  updateTextBlockWithHistory: (id: string, updates: Partial<TextBlock>, description?: string) => void;
  removeTextBlock: (id: string, skipHistory?: boolean) => void;
  restoreStrokesWithDirty: (strokes: Stroke[]) => void;

  // Настройки пера и палитры
  penCursorStyle: PenCursorStyle;
  setPenCursorStyle: (style: PenCursorStyle) => void;
  rightClickAction: RightClickAction;
  setRightClickAction: (action: RightClickAction) => void;
  eraserSize: number;
  setEraserSize: (size: number) => void;
  quickColors: string[];
  setQuickColors: (colors: string[]) => void;
  updateQuickColor: (index: number, color: string) => void;

  // Измеренная высота текстовых блоков для хитбокса
  textBlockHeights: Record<string, number>;
  setTextBlockHeight: (id: string, height: number) => void;

  setSelection: (strokeIds: string[], shapeIds: string[], textBlockIds: string[]) => void;
  clearSelection: () => void;
  moveSelectedItems: (dx: number, dy: number) => void;
  commitMoveItems: (
    prevStrokes: Stroke[],
    prevShapes: ShapeObject[],
    prevTextBlocks: TextBlock[]
  ) => void;
  deleteSelectedItems: () => void;

  flushSave: (targetPageId?: string) => Promise<void>;
  triggerAutosave: () => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => {
  const spatialIndex = new SpatialIndex();

  /**
   * Принудительное атомарное сохранение diff-изменений страницы.
   * Дожидается завершения предыдущей операции сохранения для этой страницы.
   */
  const flushSave = async (targetPageId?: string): Promise<void> => {
    const pageId = targetPageId || get().currentPageId;
    if (!pageId) return;

    // Сбрасываем ожидающий таймер debounce
    const timer = saveTimers.get(pageId);
    if (timer) {
      clearTimeout(timer);
      saveTimers.delete(pageId);
    }

    // Если прямо сейчас идет сохранение этой страницы — дожидаемся
    const inFlight = pendingSaves.get(pageId);
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        // ignore
      }
    }

    const dirty = pageDirtyMap.get(pageId);
    if (!dirty) {
      return;
    }

    // Извлекаем текущий срез изменений и сбрасываем dirty
    pageDirtyMap.delete(pageId);

    const performSave = async () => {
      set({ saveStatus: 'saving' });
      try {
        if (dirty.fullSync) {
          const { strokes, shapes, textBlocks, camera, background } = get();
          await savePageFull(pageId, { strokes, shapes, textBlocks, camera, background });
        } else {
          const diff: PageDiff = {};
          if (dirty.strokesPut.size > 0 || dirty.strokesDelete.size > 0) {
            diff.strokes = {
              put: dirty.strokesPut.size > 0 ? Array.from(dirty.strokesPut.values()) : undefined,
              deleteIds: dirty.strokesDelete.size > 0 ? Array.from(dirty.strokesDelete) : undefined,
            };
          }
          if (dirty.shapesPut.size > 0 || dirty.shapesDelete.size > 0) {
            diff.shapes = {
              put: dirty.shapesPut.size > 0 ? Array.from(dirty.shapesPut.values()) : undefined,
              deleteIds: dirty.shapesDelete.size > 0 ? Array.from(dirty.shapesDelete) : undefined,
            };
          }
          if (dirty.textBlocksPut.size > 0 || dirty.textBlocksDelete.size > 0) {
            diff.textBlocks = {
              put: dirty.textBlocksPut.size > 0 ? Array.from(dirty.textBlocksPut.values()) : undefined,
              deleteIds: dirty.textBlocksDelete.size > 0 ? Array.from(dirty.textBlocksDelete) : undefined,
            };
          }
          if (dirty.metadata) {
            diff.metadata = dirty.metadata;
          }

          // Выполняем запись только если есть реальные изменения
          if (diff.strokes || diff.shapes || diff.textBlocks || diff.metadata) {
            await savePageDiff(pageId, diff);
          }
        }
      } catch (err) {
        console.error(`Ошибка сохранения страницы ${pageId} в IndexedDB:`, err);
      } finally {
        set({ saveStatus: 'saved' });
        pendingSaves.delete(pageId);
      }
    };

    const savePromise = performSave();
    pendingSaves.set(pageId, savePromise);
    await savePromise;
  };

  /**
   * Отложенное планирование сохранения страницы (debounce 400 мс).
   * Захватывает конкретный pageId, защищая от гонок при переключении страниц.
   */
  const scheduleSave = (targetPageId?: string) => {
    const pageId = targetPageId || get().currentPageId;
    if (!pageId) return;

    set({ saveStatus: 'saving' });

    const existingTimer = saveTimers.get(pageId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const newTimer = setTimeout(() => {
      saveTimers.delete(pageId);
      flushSave(pageId);
    }, 400);

    saveTimers.set(pageId, newTimer);
  };

  return {
    canUndo: false,
    canRedo: false,
    undo: () => globalCommandStack.undo(),
    redo: () => globalCommandStack.redo(),

    activeTool: 'pen',
    penColor: '#201f1e',
    penWidth: 3,
    penCursorStyle: (localStorage.getItem('notes_cursor_style') as PenCursorStyle) || 'crosshair',
    setPenCursorStyle: (penCursorStyle) => {
      try {
        localStorage.setItem('notes_cursor_style', penCursorStyle);
      } catch {
        // ignore
      }
      set({ penCursorStyle });
    },
    rightClickAction: (localStorage.getItem('notes_right_click_action') as RightClickAction) || 'point-eraser',
    setRightClickAction: (rightClickAction) => {
      try {
        localStorage.setItem('notes_right_click_action', rightClickAction);
      } catch {
        // ignore
      }
      set({ rightClickAction });
    },
    eraserSize: Number(localStorage.getItem('notes_eraser_size')) || 16,
    setEraserSize: (eraserSize) => {
      try {
        localStorage.setItem('notes_eraser_size', String(eraserSize));
      } catch {
        // ignore
      }
      set({ eraserSize });
    },
    quickColors: ['#201f1e', '#0078d4', '#107c41', '#d83b01', '#7719aa'],
    setQuickColors: (quickColors) => set({ quickColors }),
    updateQuickColor: (index, color) =>
      set((state) => {
        const next = [...state.quickColors];
        next[index] = color;
        return { quickColors: next };
      }),

    highlighterColor: '#fff176',
    highlighterWidth: 20,
    shapeType: 'rect',
    shapeColor: '#201f1e',
    shapeWidth: 2,

    camera: { x: 0, y: 0, zoom: 1 },
    background: 'ruled',

    currentPageId: 'page-default',
    strokes: [],
    shapes: [],
    textBlocks: [],
    textBlockHeights: {},
    setTextBlockHeight: (id, height) =>
      set((state) => ({
        textBlockHeights: { ...state.textBlockHeights, [id]: height },
      })),

    selectedStrokeIds: [],
    selectedShapeIds: [],
    selectedTextBlockIds: [],

    spatialIndex,
    saveStatus: 'saved',

    setActiveTool: (tool) => {
      set({ activeTool: tool });
      if (tool !== 'cursor' && tool !== 'lasso') {
        get().clearSelection();
      }
    },
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
        const pageId = state.currentPageId;
        if (pageId) {
          const d = getOrCreateDirty(pageId);
          d.metadata = { ...d.metadata, camera: newCamera };
          scheduleSave(pageId);
        }
        return { camera: newCamera };
      });
    },

    setBackground: (background) => {
      set((state) => {
        const pageId = state.currentPageId;
        if (pageId) {
          const d = getOrCreateDirty(pageId);
          d.metadata = { ...d.metadata, background };
          scheduleSave(pageId);
        }
        return { background };
      });
    },

    loadPage: async (pageId: string, initialCamera?: Camera, initialBg?: CanvasBackground) => {
      const prevPageId = get().currentPageId;
      if (prevPageId && prevPageId !== pageId) {
        // Принудительно сохраняем предыдущую страницу до переключения
        await flushSave(prevPageId);
      }

      globalCommandStack.clear();

      const { strokes, shapes, textBlocks } = await loadPageData(pageId);

      spatialIndex.rebuild([...strokes, ...shapes]);

      set({
        currentPageId: pageId,
        strokes,
        shapes,
        textBlocks,
        selectedStrokeIds: [],
        selectedShapeIds: [],
        selectedTextBlockIds: [],
        camera: initialCamera ?? { x: 260, y: 150, zoom: 1 },
        background: initialBg ?? 'plain',
        saveStatus: 'saved',
        canUndo: false,
        canRedo: false,
      });
    },

    addStroke: (stroke) => {
      const pageId = get().currentPageId;
      globalCommandStack.execute({
        execute: () => {
          set((state) => {
            if (state.strokes.some((s) => s.id === stroke.id)) return state;
            return { strokes: [...state.strokes, stroke] };
          });
          spatialIndex.insert(stroke);
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.strokesPut.set(stroke.id, stroke);
            d.strokesDelete.delete(stroke.id);
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set((state) => {
            const nextStrokes = state.strokes.filter((s) => s.id !== stroke.id);
            spatialIndex.rebuild([...nextStrokes, ...state.shapes]);
            return { strokes: nextStrokes };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.strokesDelete.add(stroke.id);
            d.strokesPut.delete(stroke.id);
            scheduleSave(pageId);
          }
        },
        description: 'Добавление штриха',
      });
    },

    removeStroke: (strokeId) => {
      get().deleteStrokes([strokeId]);
    },

    deleteStrokes: (strokeIds) => {
      if (strokeIds.length === 0) return;
      const idsSet = new Set(strokeIds);
      const deletedStrokes = get().strokes.filter((s) => idsSet.has(s.id));
      if (deletedStrokes.length === 0) return;
      const pageId = get().currentPageId;

      globalCommandStack.execute({
        execute: () => {
          set((state) => {
            const nextStrokes = state.strokes.filter((s) => !idsSet.has(s.id));
            spatialIndex.rebuild([...nextStrokes, ...state.shapes]);
            return { strokes: nextStrokes };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            for (const id of strokeIds) {
              d.strokesDelete.add(id);
              d.strokesPut.delete(id);
            }
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set((state) => {
            const nextStrokes = [...state.strokes, ...deletedStrokes];
            spatialIndex.rebuild([...nextStrokes, ...state.shapes]);
            return { strokes: nextStrokes };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            for (const s of deletedStrokes) {
              d.strokesPut.set(s.id, s);
              d.strokesDelete.delete(s.id);
            }
            scheduleSave(pageId);
          }
        },
        description: 'Удаление штрихов',
      });
    },

    deleteStrokesSilent: (strokeIds) => {
      if (strokeIds.length === 0) return;
      const idsSet = new Set(strokeIds);
      const deletedStrokes = get().strokes.filter((s) => idsSet.has(s.id));
      if (deletedStrokes.length === 0) return;
      const pageId = get().currentPageId;

      set((state) => {
        const nextStrokes = state.strokes.filter((s) => !idsSet.has(s.id));
        spatialIndex.rebuild([...nextStrokes, ...state.shapes]);
        return { strokes: nextStrokes };
      });
      if (pageId) {
        const d = getOrCreateDirty(pageId);
        for (const id of strokeIds) {
          d.strokesDelete.add(id);
          d.strokesPut.delete(id);
        }
        scheduleSave(pageId);
      }
    },

    replaceStrokes: (replacements: Map<string, Stroke[]>) => {
      const pageId = get().currentPageId;
      const previousStrokes = get().strokes.filter((s) => replacements.has(s.id));
      if (previousStrokes.length === 0) return;

      globalCommandStack.execute({
        execute: () => {
          set((state) => {
            const nextStrokes: Stroke[] = [];
            for (const s of state.strokes) {
              if (replacements.has(s.id)) {
                const parts = replacements.get(s.id)!;
                nextStrokes.push(...parts);
              } else {
                nextStrokes.push(s);
              }
            }
            spatialIndex.rebuild([...nextStrokes, ...state.shapes]);
            return { strokes: nextStrokes };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            for (const [oldId, parts] of replacements.entries()) {
              d.strokesDelete.add(oldId);
              d.strokesPut.delete(oldId);
              for (const p of parts) {
                d.strokesPut.set(p.id, p);
                d.strokesDelete.delete(p.id);
              }
            }
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set((state) => {
            const newPartIds = new Set<string>();
            for (const parts of replacements.values()) {
              for (const p of parts) newPartIds.add(p.id);
            }
            const filtered = state.strokes.filter((s) => !newPartIds.has(s.id));
            const restored = [...filtered, ...previousStrokes];
            spatialIndex.rebuild([...restored, ...state.shapes]);
            return { strokes: restored };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            for (const [oldId, parts] of replacements.entries()) {
              const original = previousStrokes.find((s) => s.id === oldId);
              if (original) {
                d.strokesPut.set(oldId, original);
                d.strokesDelete.delete(oldId);
              }
              for (const p of parts) {
                d.strokesDelete.add(p.id);
                d.strokesPut.delete(p.id);
              }
            }
            scheduleSave(pageId);
          }
        },
        description: 'Точечный ластик',
      });
    },

    replaceStrokesSilent: (replacements: Map<string, Stroke[]>) => {
      const pageId = get().currentPageId;
      const previousStrokes = get().strokes.filter((s) => replacements.has(s.id));
      if (previousStrokes.length === 0) return;

      set((state) => {
        const nextStrokes: Stroke[] = [];
        for (const s of state.strokes) {
          if (replacements.has(s.id)) {
            const parts = replacements.get(s.id)!;
            nextStrokes.push(...parts);
          } else {
            nextStrokes.push(s);
          }
        }
        spatialIndex.rebuild([...nextStrokes, ...state.shapes]);
        return { strokes: nextStrokes };
      });
      if (pageId) {
        const d = getOrCreateDirty(pageId);
        for (const [oldId, parts] of replacements.entries()) {
          d.strokesDelete.add(oldId);
          d.strokesPut.delete(oldId);
          for (const p of parts) {
            d.strokesPut.set(p.id, p);
            d.strokesDelete.delete(p.id);
          }
        }
        scheduleSave(pageId);
      }
    },

    restoreStrokesWithDirty: (strokes: Stroke[]) => {
      const pageId = get().currentPageId;
      const currentStrokes = get().strokes;
      const nextStrokeIds = new Set(strokes.map((s) => s.id));
      const removedIds = currentStrokes.filter((s) => !nextStrokeIds.has(s.id)).map((s) => s.id);

      set({ strokes });
      spatialIndex.rebuild([...strokes, ...get().shapes]);
      if (pageId) {
        const d = getOrCreateDirty(pageId);
        for (const s of strokes) {
          d.strokesPut.set(s.id, s);
          d.strokesDelete.delete(s.id);
        }
        for (const id of removedIds) {
          d.strokesDelete.add(id);
          d.strokesPut.delete(id);
        }
        scheduleSave(pageId);
      }
    },

    addShape: (shape) => {
      const pageId = get().currentPageId;
      globalCommandStack.execute({
        execute: () => {
          set((state) => {
            if (state.shapes.some((s) => s.id === shape.id)) return state;
            return { shapes: [...state.shapes, shape] };
          });
          spatialIndex.insert(shape);
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.shapesPut.set(shape.id, shape);
            d.shapesDelete.delete(shape.id);
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set((state) => {
            const nextShapes = state.shapes.filter((s) => s.id !== shape.id);
            spatialIndex.rebuild([...state.strokes, ...nextShapes]);
            return { shapes: nextShapes };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.shapesDelete.add(shape.id);
            d.shapesPut.delete(shape.id);
            scheduleSave(pageId);
          }
        },
        description: 'Добавление фигуры',
      });
    },

    removeShape: (shapeId) => {
      const targetShape = get().shapes.find((s) => s.id === shapeId);
      if (!targetShape) return;
      const pageId = get().currentPageId;

      globalCommandStack.execute({
        execute: () => {
          set((state) => {
            const nextShapes = state.shapes.filter((s) => s.id !== shapeId);
            spatialIndex.rebuild([...state.strokes, ...nextShapes]);
            return { shapes: nextShapes };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.shapesDelete.add(shapeId);
            d.shapesPut.delete(shapeId);
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set((state) => {
            const nextShapes = [...state.shapes, targetShape];
            spatialIndex.rebuild([...state.strokes, ...nextShapes]);
            return { shapes: nextShapes };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.shapesPut.set(targetShape.id, targetShape);
            d.shapesDelete.delete(targetShape.id);
            scheduleSave(pageId);
          }
        },
        description: 'Удаление фигуры',
      });
    },

    addTextBlock: (block) => {
      const pageId = get().currentPageId;
      globalCommandStack.execute({
        execute: () => {
          set((state) => {
            if (state.textBlocks.some((b) => b.id === block.id)) return state;
            return { textBlocks: [...state.textBlocks, block] };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.textBlocksPut.set(block.id, block);
            d.textBlocksDelete.delete(block.id);
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set((state) => ({
            textBlocks: state.textBlocks.filter((b) => b.id !== block.id),
          }));
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.textBlocksDelete.add(block.id);
            d.textBlocksPut.delete(block.id);
            scheduleSave(pageId);
          }
        },
        description: 'Добавить заметку',
      });
    },

    updateTextBlock: (id, updates) => {
      const pageId = get().currentPageId;
      let updatedBlock: TextBlock | undefined;
      set((state) => {
        const nextBlocks = state.textBlocks.map((b) => {
          if (b.id === id) {
            updatedBlock = { ...b, ...updates };
            return updatedBlock;
          }
          return b;
        });
        return { textBlocks: nextBlocks };
      });
      if (pageId && updatedBlock) {
        const d = getOrCreateDirty(pageId);
        d.textBlocksPut.set(id, updatedBlock);
        d.textBlocksDelete.delete(id);
        scheduleSave(pageId);
      }
    },

    updateTextBlockWithHistory: (id, updates, description = 'Изменение заметки') => {
      const pageId = get().currentPageId;
      const prevBlock = get().textBlocks.find((b) => b.id === id);
      if (!prevBlock) return;
      const nextBlock: TextBlock = { ...prevBlock, ...updates };

      globalCommandStack.execute({
        execute: () => {
          set((state) => ({
            textBlocks: state.textBlocks.map((b) => (b.id === id ? nextBlock : b)),
          }));
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.textBlocksPut.set(id, nextBlock);
            d.textBlocksDelete.delete(id);
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set((state) => ({
            textBlocks: state.textBlocks.map((b) => (b.id === id ? prevBlock : b)),
          }));
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.textBlocksPut.set(id, prevBlock);
            d.textBlocksDelete.delete(id);
            scheduleSave(pageId);
          }
        },
        description,
      });
    },

    removeTextBlock: (id) => {
      const pageId = get().currentPageId;
      const targetBlock = get().textBlocks.find((b) => b.id === id);
      if (!targetBlock) return;

      globalCommandStack.execute({
        execute: () => {
          set((state) => ({
            textBlocks: state.textBlocks.filter((b) => b.id !== id),
          }));
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.textBlocksDelete.add(id);
            d.textBlocksPut.delete(id);
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set((state) => {
            if (state.textBlocks.some((b) => b.id === targetBlock.id)) return state;
            return { textBlocks: [...state.textBlocks, targetBlock] };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            d.textBlocksPut.set(targetBlock.id, targetBlock);
            d.textBlocksDelete.delete(targetBlock.id);
            scheduleSave(pageId);
          }
        },
        description: 'Удалить текстовый блок',
      });
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

      const pageId = get().currentPageId;
      if (pageId) {
        const d = getOrCreateDirty(pageId);
        for (const s of get().strokes) {
          if (strokeSet.has(s.id)) d.strokesPut.set(s.id, s);
        }
        for (const sh of get().shapes) {
          if (shapeSet.has(sh.id)) d.shapesPut.set(sh.id, sh);
        }
        for (const tb of get().textBlocks) {
          if (tbSet.has(tb.id)) d.textBlocksPut.set(tb.id, tb);
        }
        scheduleSave(pageId);
      }
    },

    commitMoveItems: (prevStrokes, prevShapes, prevTextBlocks) => {
      const currentStrokes = [...get().strokes];
      const currentShapes = [...get().shapes];
      const currentTextBlocks = [...get().textBlocks];
      const pageId = get().currentPageId;

      globalCommandStack.execute({
        execute: () => {
          set({
            strokes: currentStrokes,
            shapes: currentShapes,
            textBlocks: currentTextBlocks,
          });
          spatialIndex.rebuild([...currentStrokes, ...currentShapes]);
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            for (const s of currentStrokes) d.strokesPut.set(s.id, s);
            for (const sh of currentShapes) d.shapesPut.set(sh.id, sh);
            for (const tb of currentTextBlocks) d.textBlocksPut.set(tb.id, tb);
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set({
            strokes: prevStrokes,
            shapes: prevShapes,
            textBlocks: prevTextBlocks,
          });
          spatialIndex.rebuild([...prevStrokes, ...prevShapes]);
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            for (const s of prevStrokes) d.strokesPut.set(s.id, s);
            for (const sh of prevShapes) d.shapesPut.set(sh.id, sh);
            for (const tb of prevTextBlocks) d.textBlocksPut.set(tb.id, tb);
            scheduleSave(pageId);
          }
        },
        description: 'Перемещение объектов',
      });
    },

    deleteSelectedItems: () => {
      const { selectedStrokeIds, selectedShapeIds, selectedTextBlockIds, strokes, shapes, textBlocks } = get();
      if (!selectedStrokeIds.length && !selectedShapeIds.length && !selectedTextBlockIds.length) return;

      const strokeSet = new Set(selectedStrokeIds);
      const shapeSet = new Set(selectedShapeIds);
      const tbSet = new Set(selectedTextBlockIds);

      const deletedStrokes = strokes.filter((s) => strokeSet.has(s.id));
      const deletedShapes = shapes.filter((sh) => shapeSet.has(sh.id));
      const deletedTextBlocks = textBlocks.filter((tb) => tbSet.has(tb.id));
      const pageId = get().currentPageId;

      globalCommandStack.execute({
        execute: () => {
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
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            for (const s of deletedStrokes) {
              d.strokesDelete.add(s.id);
              d.strokesPut.delete(s.id);
            }
            for (const sh of deletedShapes) {
              d.shapesDelete.add(sh.id);
              d.shapesPut.delete(sh.id);
            }
            for (const tb of deletedTextBlocks) {
              d.textBlocksDelete.add(tb.id);
              d.textBlocksPut.delete(tb.id);
            }
            scheduleSave(pageId);
          }
        },
        undo: () => {
          set((state) => {
            const nextStrokes = [...state.strokes, ...deletedStrokes];
            const nextShapes = [...state.shapes, ...deletedShapes];
            const nextTextBlocks = [...state.textBlocks, ...deletedTextBlocks];
            spatialIndex.rebuild([...nextStrokes, ...nextShapes]);

            return {
              strokes: nextStrokes,
              shapes: nextShapes,
              textBlocks: nextTextBlocks,
              selectedStrokeIds,
              selectedShapeIds,
              selectedTextBlockIds,
            };
          });
          if (pageId) {
            const d = getOrCreateDirty(pageId);
            for (const s of deletedStrokes) {
              d.strokesPut.set(s.id, s);
              d.strokesDelete.delete(s.id);
            }
            for (const sh of deletedShapes) {
              d.shapesPut.set(sh.id, sh);
              d.shapesDelete.delete(sh.id);
            }
            for (const tb of deletedTextBlocks) {
              d.textBlocksPut.set(tb.id, tb);
              d.textBlocksDelete.delete(tb.id);
            }
            scheduleSave(pageId);
          }
        },
        description: 'Удалить выделенное',
      });
    },

    flushSave,
    triggerAutosave: () => flushSave(),
  };
});

// Синхронизация состояния canUndo / canRedo с хранилищем
globalCommandStack.subscribe(() => {
  useCanvasStore.setState({
    canUndo: globalCommandStack.canUndo(),
    canRedo: globalCommandStack.canRedo(),
  });
});
