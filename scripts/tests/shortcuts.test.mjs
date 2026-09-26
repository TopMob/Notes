import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesKeyShortcut,
  formatKeyShortcutLabel,
  formatMouseTriggerLabel,
  DEFAULT_SHORTCUTS,
  useShortcutsStore,
} from '../../src/store/useShortcutsStore.ts';

describe('Управление горячими клавишами и аккордами мыши (Этап 3)', () => {
  it('Распознает комбинацию Ctrl+Z как на английской, так и на русской раскладке', () => {
    const shortcut = { code: 'KeyZ', ctrl: true };

    // Английская раскладка: code: KeyZ, key: z
    const enEvent = {
      code: 'KeyZ',
      key: 'z',
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    };
    assert.equal(matchesKeyShortcut(enEvent, shortcut), true);

    // Русская раскладка: code: KeyZ, key: я
    const ruEvent = {
      code: 'KeyZ',
      key: 'я',
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    };
    assert.equal(matchesKeyShortcut(ruEvent, shortcut), true);

    // Не совпадает, если зажат Shift (Shift+Ctrl+Z != Ctrl+Z)
    const shiftEvent = {
      code: 'KeyZ',
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    };
    assert.equal(matchesKeyShortcut(shiftEvent, shortcut), false);
  });

  it('Распознает одиночные клавиши (Escape, Space, Delete, P, E)', () => {
    assert.equal(
      matchesKeyShortcut(
        { code: 'Space', key: ' ', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false },
        { code: 'Space' }
      ),
      true
    );

    assert.equal(
      matchesKeyShortcut(
        { code: 'Escape', key: 'Escape', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false },
        { code: 'Escape' }
      ),
      true
    );

    assert.equal(
      matchesKeyShortcut(
        { code: 'KeyP', key: 'p', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false },
        { code: 'KeyP' }
      ),
      true
    );
  });

  it('Форматирует сочетания клавиш и кнопки мыши в понятные подписи', () => {
    assert.equal(formatKeyShortcutLabel({ code: 'KeyZ', ctrl: true }), 'Ctrl + Z');
    assert.equal(formatKeyShortcutLabel({ code: 'KeyZ', ctrl: true, shift: true }), 'Ctrl + Shift + Z');
    assert.equal(formatKeyShortcutLabel({ code: 'Space' }), 'Пробел');
    assert.equal(formatKeyShortcutLabel({ code: 'Delete' }), 'Del');
    assert.equal(formatMouseTriggerLabel('rmb+lmb'), 'ПКМ + ЛКМ');
    assert.equal(formatMouseTriggerLabel('mmb'), 'СКМ (Колесико)');
  });

  it('По умолчанию аккорд ПКМ+ЛКМ привязан к Undo', () => {
    assert.equal(useShortcutsStore.getState().getActionByMouseChord('rmb+lmb'), 'undo');
  });

  it('Позволяет переназначить аккорд ПКМ+ЛКМ на другое действие или изменить клавиши', () => {
    const store = useShortcutsStore.getState();

    // Переназначаем rmb+lmb на redo
    store.setMouseTriggers('undo', []);
    store.setMouseTriggers('redo', ['rmb+lmb']);

    assert.equal(useShortcutsStore.getState().getActionByMouseChord('rmb+lmb'), 'redo');

    // Сбрасываем к значениям по умолчанию
    store.resetToDefaults();
    assert.equal(useShortcutsStore.getState().getActionByMouseChord('rmb+lmb'), 'undo');
  });
});
