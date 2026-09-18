import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GestureManager } from '../../src/canvas/input/GestureManager.ts';

// Вспомогательная функция для создания mock PointerEvent
function createPointerEvent(type, {
  pointerId,
  pointerType = 'touch',
  clientX = 100,
  clientY = 100,
  buttons = 1,
  button = 0,
  pressure = 0.5,
}) {
  return {
    type,
    pointerId,
    pointerType,
    clientX,
    clientY,
    buttons,
    button,
    pressure,
    currentTarget: {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
    },
    preventDefault: () => {},
    stopPropagation: () => {},
  };
}

describe('7. Распознавание жестов и мультитач-навигация (Задача 8)', () => {
  test('1. Два одновременных pointerdown/up в пределах порога времени и смещения -> Undo', async () => {
    let undoTriggered = false;
    let redoTriggered = false;
    let panZoomCalls = [];

    const manager = new GestureManager({
      onUndo: () => {
        undoTriggered = true;
      },
      onRedo: () => {
        redoTriggered = true;
      },
      onPanZoom: (params) => {
        panZoomCalls.push(params);
      },
    }, {
      tapMaxDurationMs: 250,
      tapMaxDisplacementPx: 12,
      multiTapDownWindowMs: 100,
    });

    // Палец 1 касается экрана в t=0
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }));
    // Палец 2 касается экрана в t=20ms (окно < 100ms)
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 }));

    // Небольшой микро-сдвиг (в пределах 12px)
    manager.handlePointerMove(createPointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 103, clientY: 102 }));
    manager.handlePointerMove(createPointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 198, clientY: 101 }));

    // Отпускаем оба пальца быстро (< 250ms)
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 103, clientY: 102 }));
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 198, clientY: 101 }));

    assert.strictEqual(undoTriggered, true, 'Быстрый тап 2 пальцами должен вызывать Undo');
    assert.strictEqual(redoTriggered, false, 'Redo не должен вызываться при 2 пальцах');
    assert.strictEqual(panZoomCalls.length, 0, 'Pan/Zoom не должен срабатывать при тапе меньше порога смещения');
  });

  test('2. Два пальца с движением больше порога -> срабатывает Pan/Zoom, но НЕ Undo', async () => {
    let undoTriggered = false;
    let panZoomCalls = [];

    const manager = new GestureManager({
      onUndo: () => {
        undoTriggered = true;
      },
      onPanZoom: (params) => {
        panZoomCalls.push(params);
      },
    }, {
      tapMaxDurationMs: 250,
      tapMaxDisplacementPx: 12,
    });

    // Палец 1 и Палец 2 касаются
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }));
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 }));

    // Движение больше 12px (панорамирование + растягивание/pinch)
    manager.handlePointerMove(createPointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 80, clientY: 100 })); // dx = -20px
    manager.handlePointerMove(createPointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 240, clientY: 100 })); // dx = +40px

    // Отпускаем
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 80, clientY: 100 }));
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 240, clientY: 100 }));

    assert.strictEqual(panZoomCalls.length > 0, true, 'Движение 2 пальцами должно диспатчить pan/zoom');
    assert.strictEqual(undoTriggered, false, 'Undo НЕ должен вызываться, если смещение превысило порог');
  });

  test('3. Три пальца: быстрый тап -> срабатывает Redo (Ctrl+Y)', async () => {
    let redoTriggered = false;
    let undoTriggered = false;

    const manager = new GestureManager({
      onUndo: () => {
        undoTriggered = true;
      },
      onRedo: () => {
        redoTriggered = true;
      },
    }, {
      tapMaxDurationMs: 250,
      tapMaxDisplacementPx: 12,
      multiTapDownWindowMs: 100,
    });

    // 3 пальца касаются
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }));
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 150, clientY: 100 }));
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 100 }));

    // Отпускаются быстро
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 102, clientY: 101 }));
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 151, clientY: 102 }));
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 202, clientY: 101 }));

    assert.strictEqual(redoTriggered, true, 'Быстрый тап 3 пальцами должен вызывать Redo');
    assert.strictEqual(undoTriggered, false, 'Undo не должен вызываться при 3 пальцах');
  });

  test('4. Palm Rejection: пока активен стилус (pen), одновременный touch полностью игнорируется', async () => {
    let singleDownCount = 0;
    let singleMoveCount = 0;
    let undoTriggered = false;
    let panZoomTriggered = false;

    const manager = new GestureManager({
      onSinglePointerDown: (e) => {
        singleDownCount++;
      },
      onSinglePointerMove: (e) => {
        singleMoveCount++;
      },
      onUndo: () => {
        undoTriggered = true;
      },
      onPanZoom: () => {
        panZoomTriggered = true;
      },
    });

    // 1. Стилус касается экрана (pointerType === 'pen')
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 10, pointerType: 'pen', clientX: 300, clientY: 300 }));
    assert.strictEqual(manager.isPalmRejectionActive(), true, 'Palm rejection должен быть активен при касании стилуса');
    assert.strictEqual(singleDownCount, 1, 'Стилус должен регистрировать pointer down');

    // 2. Ладонь/палец касается экрана одновременно со стилусом (pointerType === 'touch')
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 20, pointerType: 'touch', clientX: 100, clientY: 500 }));
    // Ладонь двигается
    manager.handlePointerMove(createPointerEvent('pointermove', { pointerId: 20, pointerType: 'touch', clientX: 120, clientY: 510 }));
    // Ладонь отрывается
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 20, pointerType: 'touch', clientX: 120, clientY: 510 }));

    // Проверяем: события ладони не должны были вызвать ни рисование, ни панорамирование, ни Undo
    assert.strictEqual(singleDownCount, 1, 'Тач от ладони НЕ должен вызывать singlePointerDown');
    assert.strictEqual(singleMoveCount, 0, 'Движение ладони НЕ должно диспатчиться в singlePointerMove');
    assert.strictEqual(undoTriggered, false, 'Ладонь не должна триггерить жесты Undo');
    assert.strictEqual(panZoomTriggered, false, 'Ладонь не должна панорамировать холст');

    // 3. Стилус отрывается
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 10, pointerType: 'pen', clientX: 300, clientY: 300 }));
    assert.strictEqual(manager.isPalmRejectionActive(), false, 'Palm rejection отключается после отрыва стилуса');
  });

  test('5. Palm Rejection: если палец коснулся первым, но следом пришёл стилус — тач отменяется (onCancelActiveStroke)', async () => {
    let cancelCalled = false;

    const manager = new GestureManager({
      onCancelActiveStroke: () => {
        cancelCalled = true;
      },
    });

    // 1. Палец касается (например, ребро ладони коснулось стекла за 10мс до пера)
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }));
    assert.strictEqual(cancelCalled, false);

    // 2. Стилус касается экрана
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 2, pointerType: 'pen', clientX: 200, clientY: 200 }));
    assert.strictEqual(cancelCalled, true, 'Касание стилуса должно немедленно отменить случайный штрих ладони');
  });

  test('6. Буферизация 1 пальца: при касании 2-го пальца в пределах 100мс незавершённый штрих отменяется', async () => {
    let cancelCalled = false;

    const manager = new GestureManager({
      onCancelActiveStroke: () => {
        cancelCalled = true;
      },
    });

    // 1-й палец касается
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }));
    assert.strictEqual(cancelCalled, false);

    // 2-й палец касается почти одновременно (например, для масштабирования или undo)
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 }));
    assert.strictEqual(cancelCalled, true, 'Начало 2-пальцевого взаимодействия должно отменять случайную точку первого пальца');
  });

  test('7. Draw with Touch: переключение между рисованием и панорамированием одним пальцем', async () => {
    let singleDownCount = 0;
    let panCalls = [];

    const manager = new GestureManager({
      onSinglePointerDown: () => {
        singleDownCount++;
      },
      onPanZoom: (p) => {
        panCalls.push(p);
      },
    }, {
      drawWithTouch: true,
    });

    // При drawWithTouch: true 1 палец вызывает onSinglePointerDown
    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }));
    assert.strictEqual(singleDownCount, 1);
    manager.handlePointerUp(createPointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }));

    // Отключаем рисование пальцем (drawWithTouch: false)
    manager.updateOptions({ drawWithTouch: false });

    manager.handlePointerDown(createPointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 100 }));
    assert.strictEqual(singleDownCount, 1, 'При drawWithTouch: false 1 палец НЕ начинает рисование');

    // Движение пальца вызывает onPanZoom
    manager.handlePointerMove(createPointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 120, clientY: 130 }));
    assert.strictEqual(panCalls.length > 0, true, 'При drawWithTouch: false 1 палец панорамирует холст');
    assert.strictEqual(panCalls[0].dx, 20);
    assert.strictEqual(panCalls[0].dy, 30);
  });
});
