import { create } from 'zustand';

export type MouseChordType = 'rmb+lmb' | 'lmb+rmb' | 'mmb' | 'mouse4' | 'mouse5' | 'none';

export interface KeyShortcut {
  code: string; // Например, 'KeyZ', 'KeyY', 'Space', 'Delete', 'Escape', 'F11'
  key?: string; // Символ клавиши для подсказки
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export type ShortcutCategory = 'edit' | 'tools' | 'canvas' | 'view';

export interface ShortcutBinding {
  id: string;
  name: string;
  description: string;
  category: ShortcutCategory;
  keyShortcuts: KeyShortcut[];
  mouseTriggers: MouseChordType[];
}

export const DEFAULT_SHORTCUTS: Record<string, ShortcutBinding> = {
  undo: {
    id: 'undo',
    name: 'Отменить действие (Undo)',
    description: 'Отмена последнего штриха, текста или фигуры',
    category: 'edit',
    keyShortcuts: [{ code: 'KeyZ', ctrl: true }],
    mouseTriggers: ['rmb+lmb'],
  },
  redo: {
    id: 'redo',
    name: 'Повторить действие (Redo)',
    description: 'Повтор отмененного действия',
    category: 'edit',
    keyShortcuts: [
      { code: 'KeyY', ctrl: true },
      { code: 'KeyZ', ctrl: true, shift: true },
    ],
    mouseTriggers: [],
  },
  delete_selected: {
    id: 'delete_selected',
    name: 'Удалить выбранное',
    description: 'Удаление выделенных штрихов, фигур или блоков',
    category: 'edit',
    keyShortcuts: [{ code: 'Delete' }, { code: 'Backspace' }],
    mouseTriggers: [],
  },
  tool_pen: {
    id: 'tool_pen',
    name: 'Инструмент: Ручка / Перо',
    description: 'Быстрое переключение на перо для рисования',
    category: 'tools',
    keyShortcuts: [{ code: 'KeyP' }],
    mouseTriggers: [],
  },
  tool_highlighter: {
    id: 'tool_highlighter',
    name: 'Инструмент: Маркер',
    description: 'Быстрое переключение на текстовыделитель',
    category: 'tools',
    keyShortcuts: [{ code: 'KeyH' }],
    mouseTriggers: [],
  },
  tool_eraser: {
    id: 'tool_eraser',
    name: 'Инструмент: Ластик',
    description: 'Быстрое переключение на инструмент ластик',
    category: 'tools',
    keyShortcuts: [{ code: 'KeyE' }],
    mouseTriggers: [],
  },
  tool_cursor: {
    id: 'tool_cursor',
    name: 'Инструмент: Выделение / Курсор',
    description: 'Переключение в режим перемещения и выделения',
    category: 'tools',
    keyShortcuts: [{ code: 'KeyV' }],
    mouseTriggers: [],
  },
  tool_lasso: {
    id: 'tool_lasso',
    name: 'Инструмент: Лассо',
    description: 'Выделение произвольной области объектов',
    category: 'tools',
    keyShortcuts: [{ code: 'KeyL' }],
    mouseTriggers: [],
  },
  pan_hold: {
    id: 'pan_hold',
    name: 'Панорамирование холста',
    description: 'Смещение холста при зажатии клавиши пробела или кнопки мыши',
    category: 'canvas',
    keyShortcuts: [{ code: 'Space' }],
    mouseTriggers: ['mmb'],
  },
  clear_selection: {
    id: 'clear_selection',
    name: 'Снять выделение',
    description: 'Сброс выбора объектов или отмена операции',
    category: 'canvas',
    keyShortcuts: [{ code: 'Escape' }],
    mouseTriggers: [],
  },
  search: {
    id: 'search',
    name: 'Быстрый поиск',
    description: 'Открыть окно поиска заметок',
    category: 'view',
    keyShortcuts: [{ code: 'KeyF', ctrl: true }],
    mouseTriggers: [],
  },
  zen_mode: {
    id: 'zen_mode',
    name: 'Полноэкранный Zen-режим',
    description: 'Скрыть сайдбар и панели для максимальной концентрации',
    category: 'view',
    keyShortcuts: [{ code: 'F11' }],
    mouseTriggers: [],
  },
};

const STORAGE_KEY = 'notes_custom_shortcuts';

function loadShortcutsFromStorage(): Record<string, ShortcutBinding> {
  if (typeof window === 'undefined') return { ...DEFAULT_SHORTCUTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHORTCUTS };
    const parsed = JSON.parse(raw);
    const result: Record<string, ShortcutBinding> = { ...DEFAULT_SHORTCUTS };
    for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
      if (parsed[key]) {
        result[key] = {
          ...DEFAULT_SHORTCUTS[key],
          keyShortcuts: Array.isArray(parsed[key].keyShortcuts)
            ? parsed[key].keyShortcuts
            : DEFAULT_SHORTCUTS[key].keyShortcuts,
          mouseTriggers: Array.isArray(parsed[key].mouseTriggers)
            ? parsed[key].mouseTriggers
            : DEFAULT_SHORTCUTS[key].mouseTriggers,
        };
      }
    }
    return result;
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

function saveShortcutsToStorage(shortcuts: Record<string, ShortcutBinding>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
  } catch {
    // ignore
  }
}

/**
 * Проверяет, соответствует ли событие клавиатуры заданному шорткату
 * Поддерживает как физический `code` (KeyZ), так и русскую раскладку через букву `key`.
 */
export function matchesKeyShortcut(e: KeyboardEvent, s: KeyShortcut): boolean {
  const isCtrlOrMeta = Boolean(e.ctrlKey || e.metaKey);
  const isShift = Boolean(e.shiftKey);
  const isAlt = Boolean(e.altKey);

  if (isCtrlOrMeta !== Boolean(s.ctrl)) return false;
  if (isShift !== Boolean(s.shift)) return false;
  if (isAlt !== Boolean(s.alt)) return false;

  // 1. Прямое совпадение по code (не зависит от раскладки: KeyZ всегда KeyZ)
  if (e.code === s.code) return true;

  // 2. Дополнительная проверка по буквам (для нестандартных платформ/раскладок)
  if (s.code.startsWith('Key')) {
    const targetLetter = s.code.slice(3).toLowerCase();
    const eventKey = e.key.toLowerCase();
    if (eventKey === targetLetter) return true;

    // Русская раскладка ЙЦУКЕН маппинг популярных букв
    const RU_TO_EN_LETTER: Record<string, string> = {
      я: 'z',
      н: 'y',
      п: 'g',
      р: 'h',
      у: 'e',
      з: 'p',
      м: 'v',
      д: 'l',
      а: 'f',
      с: 'c',
    };
    if (RU_TO_EN_LETTER[eventKey] === targetLetter) return true;
  }

  return false;
}

/**
 * Форматирует шорткат в читаемый текст (например: "Ctrl + Z", "Shift + F11")
 */
export function formatKeyShortcutLabel(s: KeyShortcut): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push('Ctrl');
  if (s.alt) parts.push('Alt');
  if (s.shift) parts.push('Shift');
  if (s.meta) parts.push('Cmd');

  let keyLabel = s.code;
  if (keyLabel.startsWith('Key')) {
    keyLabel = keyLabel.slice(3);
  } else if (keyLabel.startsWith('Digit')) {
    keyLabel = keyLabel.slice(5);
  } else if (keyLabel === 'Space') {
    keyLabel = 'Пробел';
  } else if (keyLabel === 'Delete') {
    keyLabel = 'Del';
  } else if (keyLabel === 'Backspace') {
    keyLabel = 'Backspace';
  } else if (keyLabel === 'Escape') {
    keyLabel = 'Esc';
  }

  parts.push(keyLabel);
  return parts.join(' + ');
}

export function formatMouseTriggerLabel(t: MouseChordType): string {
  switch (t) {
    case 'rmb+lmb':
      return 'ПКМ + ЛКМ';
    case 'lmb+rmb':
      return 'ЛКМ + ПКМ';
    case 'mmb':
      return 'СКМ (Колесико)';
    case 'mouse4':
      return 'Боковая кнопка 4 (Назад)';
    case 'mouse5':
      return 'Боковая кнопка 5 (Вперед)';
    default:
      return '';
  }
}

interface ShortcutsState {
  shortcuts: Record<string, ShortcutBinding>;

  // Действия
  setKeyShortcuts: (actionId: string, keyShortcuts: KeyShortcut[]) => void;
  setMouseTriggers: (actionId: string, mouseTriggers: MouseChordType[]) => void;
  addKeyShortcut: (actionId: string, shortcut: KeyShortcut) => void;
  removeKeyShortcut: (actionId: string, index: number) => void;
  toggleMouseTrigger: (actionId: string, trigger: MouseChordType) => void;
  resetToDefaults: () => void;

  // Определение совпадения действия
  getActionByKeyEvent: (e: KeyboardEvent) => string | null;
  getActionByMouseChord: (chord: MouseChordType) => string | null;
}

export const useShortcutsStore = create<ShortcutsState>((set, get) => ({
  shortcuts: loadShortcutsFromStorage(),

  setKeyShortcuts: (actionId, keyShortcuts) => {
    set((state) => {
      if (!state.shortcuts[actionId]) return state;
      const updated = {
        ...state.shortcuts,
        [actionId]: {
          ...state.shortcuts[actionId],
          keyShortcuts,
        },
      };
      saveShortcutsToStorage(updated);
      return { shortcuts: updated };
    });
  },

  setMouseTriggers: (actionId, mouseTriggers) => {
    set((state) => {
      if (!state.shortcuts[actionId]) return state;
      const updated = {
        ...state.shortcuts,
        [actionId]: {
          ...state.shortcuts[actionId],
          mouseTriggers,
        },
      };
      saveShortcutsToStorage(updated);
      return { shortcuts: updated };
    });
  },

  addKeyShortcut: (actionId, shortcut) => {
    set((state) => {
      const binding = state.shortcuts[actionId];
      if (!binding) return state;

      // Избегаем дубликатов
      const exists = binding.keyShortcuts.some(
        (s) =>
          s.code === shortcut.code &&
          Boolean(s.ctrl) === Boolean(shortcut.ctrl) &&
          Boolean(s.shift) === Boolean(shortcut.shift) &&
          Boolean(s.alt) === Boolean(shortcut.alt)
      );
      if (exists) return state;

      const updated = {
        ...state.shortcuts,
        [actionId]: {
          ...binding,
          keyShortcuts: [...binding.keyShortcuts, shortcut],
        },
      };
      saveShortcutsToStorage(updated);
      return { shortcuts: updated };
    });
  },

  removeKeyShortcut: (actionId, index) => {
    set((state) => {
      const binding = state.shortcuts[actionId];
      if (!binding) return state;
      const updatedList = binding.keyShortcuts.filter((_, i) => i !== index);
      const updated = {
        ...state.shortcuts,
        [actionId]: {
          ...binding,
          keyShortcuts: updatedList,
        },
      };
      saveShortcutsToStorage(updated);
      return { shortcuts: updated };
    });
  },

  toggleMouseTrigger: (actionId, trigger) => {
    set((state) => {
      const binding = state.shortcuts[actionId];
      if (!binding) return state;

      const has = binding.mouseTriggers.includes(trigger);
      const updatedTriggers = has
        ? binding.mouseTriggers.filter((t) => t !== trigger)
        : [...binding.mouseTriggers, trigger];

      const updated = {
        ...state.shortcuts,
        [actionId]: {
          ...binding,
          mouseTriggers: updatedTriggers,
        },
      };
      saveShortcutsToStorage(updated);
      return { shortcuts: updated };
    });
  },

  resetToDefaults: () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    set({ shortcuts: { ...DEFAULT_SHORTCUTS } });
  },

  getActionByKeyEvent: (e: KeyboardEvent) => {
    const { shortcuts } = get();
    for (const actionId of Object.keys(shortcuts)) {
      const binding = shortcuts[actionId];
      if (binding.keyShortcuts.some((s) => matchesKeyShortcut(e, s))) {
        return actionId;
      }
    }
    return null;
  },

  getActionByMouseChord: (chord: MouseChordType) => {
    if (chord === 'none') return null;
    const { shortcuts } = get();
    for (const actionId of Object.keys(shortcuts)) {
      const binding = shortcuts[actionId];
      if (binding.mouseTriggers?.includes(chord)) {
        return actionId;
      }
    }
    return null;
  },
}));
