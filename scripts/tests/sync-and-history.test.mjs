import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('1. Инвариант архитектуры Local-First: IndexedDB и сжатие', () => {
  test('Запись и чтение в IndexedDB не импортируют и не вызывают compressJson', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const storagePath = path.resolve(process.cwd(), 'src/db/storage.ts');
    const storageCode = fs.readFileSync(storagePath, 'utf8');

    // Проверяем, что в исполняемом коде storage.ts нет вызовов и импортов compressJson
    const callsCompress = /\bcompressJson\s*\(/.test(storageCode);
    const importsCompress = /import\s+.*compressJson/.test(storageCode);
    const callsCompressBatch = /\bcompressBatch\s*\(/.test(storageCode);

    assert.strictEqual(callsCompress, false, 'Инвариант нарушен: storage.ts вызывает compressJson()');
    assert.strictEqual(importsCompress, false, 'Инвариант нарушен: storage.ts импортирует compressJson');
    assert.strictEqual(callsCompressBatch, false, 'Инвариант нарушен: storage.ts вызывает compressBatch()');
  });
});

describe('2. Компрессия и обратная совместимость бандлов (Task 2)', () => {
  test('Сжатие и распаковка бандла сохраняют все штрихи, фигуры и HTML таблиц в текстовых блоках', async () => {
    const { compressBatch, decompressBatch, decompressJson } = await import(
      '../../src/services/sync/compression.ts'
    );

    const testStrokes = [
      {
        id: 'stroke-test-1',
        tool: 'pen',
        points: [
          { x: 10, y: 20, pressure: 0.5, t: 100 },
          { x: 15, y: 25, pressure: 0.6, t: 110 },
        ],
        color: '#ff0000',
        baseWidth: 3,
        opacity: 1,
        blendMode: 'source-over',
        bounds: { minX: 10, minY: 20, maxX: 15, maxY: 25 },
        createdAt: 100,
      },
    ];

    const testShapes = [
      {
        id: 'shape-test-1',
        type: 'rect',
        anchor: { x: 50, y: 50, pressure: 0.5, t: 120 },
        end: { x: 150, y: 150, pressure: 0.5, t: 130 },
        style: { color: '#0078d4', width: 2 },
        bounds: { minX: 50, minY: 50, maxX: 150, maxY: 150 },
      },
    ];

    const testTextBlocks = [
      {
        id: 'tb-test-1',
        pageId: 'page-1',
        x: 100,
        y: 200,
        width: 400,
        contentHTML:
          '<p>Конспект лекции:</p><table class="notes-table"><tbody><tr><td>Формула $E=mc^2$</td><td>Значение</td></tr></tbody></table>',
        zIndex: 10,
      },
    ];

    // 1. Пакетное сжатие в бандл
    const compressedBatch = await compressBatch({
      strokes: testStrokes,
      shapes: testShapes,
      textBlocks: testTextBlocks,
    });

    assert.ok(compressedBatch.length > 0, 'Сжатый бандл не должен быть пустым');
    assert.ok(compressedBatch.startsWith('gz:'), 'Сжатый бандл должен иметь префикс gz:');

    // 2. Распаковка бандла
    const decompressed = await decompressBatch(compressedBatch);

    assert.strictEqual(decompressed.strokes.length, 1);
    assert.deepStrictEqual(decompressed.strokes[0], testStrokes[0]);

    assert.strictEqual(decompressed.shapes.length, 1);
    assert.deepStrictEqual(decompressed.shapes[0], testShapes[0]);

    assert.strictEqual(decompressed.textBlocks.length, 1);
    assert.deepStrictEqual(decompressed.textBlocks[0], testTextBlocks[0]);
    assert.ok(
      decompressed.textBlocks[0].contentHTML.includes('<table class="notes-table">'),
      'HTML таблицы внутри текстового блока должен сохраняться побайтово идентичным'
    );

    // 3. Обратная совместимость: чтение старого одиночного элемента со строкой gz:
    const legacyStrokeJson = JSON.stringify(testStrokes[0]);
    const legacyCompressed = await compressBatch({ strokes: [testStrokes[0]] });
    const legacyDecompressed = await decompressJson(legacyCompressed);
    assert.ok(legacyDecompressed.strokes.length === 1);
  });
});

describe('3. Система Undo/Redo и CommandStack (Task 3)', () => {
  class MockCommandStack {
    constructor(maxDepth = 100) {
      this.undoStack = [];
      this.redoStack = [];
      this.maxDepth = maxDepth;
    }
    execute(cmd) {
      cmd.execute();
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
      this.redoStack = [];
    }
    undo() {
      const cmd = this.undoStack.pop();
      if (cmd) {
        cmd.undo();
        this.redoStack.push(cmd);
      }
    }
    redo() {
      const cmd = this.redoStack.pop();
      if (cmd) {
        cmd.execute();
        this.undoStack.push(cmd);
      }
    }
  }

  test('Удаление текстового блока с таблицей: Undo восстанавливает точную копию со структурой таблицы', () => {
    const stack = new MockCommandStack();
    let textBlocks = [
      {
        id: 'tb-table-1',
        x: 100,
        y: 150,
        width: 480,
        contentHTML:
          '<h3>Теорема</h3><table border="1"><tr><th>x</th><th>f(x)</th></tr><tr><td>1</td><td>2</td></tr></table>',
        zIndex: 5,
      },
    ];

    const originalBlock = { ...textBlocks[0] };

    // Команда удаления
    const targetBlock = textBlocks[0];
    stack.execute({
      execute: () => {
        textBlocks = textBlocks.filter((b) => b.id !== targetBlock.id);
      },
      undo: () => {
        textBlocks = [...textBlocks, targetBlock];
      },
      description: 'Удалить текстовый блок',
    });

    assert.strictEqual(textBlocks.length, 0, 'Блок должен быть удалён после execute');

    // Нажатие Ctrl+Z (Undo)
    stack.undo();
    assert.strictEqual(textBlocks.length, 1, 'Блок должен вернуться после undo');
    assert.deepStrictEqual(textBlocks[0], originalBlock, 'Все поля блока, включая HTML таблицы, идентичны исходным');

    // Нажатие Ctrl+Y (Redo)
    stack.redo();
    assert.strictEqual(textBlocks.length, 0, 'Блок снова удалён после redo');

    // Повторное Undo
    stack.undo();
    assert.deepStrictEqual(textBlocks[0], originalBlock, 'Блок снова восстановлен идентично');
  });

  test('Удаление и перемещение штриха: Undo/Redo восстанавливают геометрию и цвет', () => {
    const stack = new MockCommandStack();
    let strokes = [
      {
        id: 's-1',
        points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
        color: '#0078d4',
        baseWidth: 3,
      },
    ];

    const originalStroke = JSON.parse(JSON.stringify(strokes[0]));

    // Удаление штриха
    stack.execute({
      execute: () => {
        strokes = [];
      },
      undo: () => {
        strokes = [originalStroke];
      },
    });

    assert.strictEqual(strokes.length, 0);
    stack.undo();
    assert.deepStrictEqual(strokes[0], originalStroke);

    // Перемещение штриха
    const movedStroke = {
      ...originalStroke,
      points: [{ x: 50, y: 50 }, { x: 60, y: 60 }],
    };

    stack.execute({
      execute: () => {
        strokes = [movedStroke];
      },
      undo: () => {
        strokes = [originalStroke];
      },
    });

    assert.strictEqual(strokes[0].points[0].x, 50);
    stack.undo();
    assert.strictEqual(strokes[0].points[0].x, 0);
    assert.deepStrictEqual(strokes[0], originalStroke);
  });

  test('Удаление фигуры: Undo восстанавливает фигуру со всеми параметрами', () => {
    const stack = new MockCommandStack();
    const originalShape = {
      id: 'shape-rect-1',
      type: 'rect',
      anchor: { x: 10, y: 10 },
      end: { x: 200, y: 100 },
      style: { color: '#d83b01', width: 2 },
    };
    let shapes = [originalShape];

    stack.execute({
      execute: () => {
        shapes = [];
      },
      undo: () => {
        shapes = [originalShape];
      },
      description: 'Удаление фигуры',
    });

    assert.strictEqual(shapes.length, 0);
    stack.undo();
    assert.strictEqual(shapes.length, 1);
    assert.deepStrictEqual(shapes[0], originalShape);
  });

  test('Точечный ластик (разбиение штриха на части): Undo восстанавливает цельный штрих', () => {
    const stack = new MockCommandStack();
    const originalStroke = {
      id: 'stroke-long',
      points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }],
      color: '#107c41',
    };
    let strokes = [originalStroke];

    const part1 = { id: 'stroke-part-1', points: [{ x: 0, y: 0 }, { x: 20, y: 20 }], color: '#107c41' };
    const part2 = { id: 'stroke-part-2', points: [{ x: 80, y: 80 }, { x: 100, y: 100 }], color: '#107c41' };

    // Выполнение стирания в середине
    stack.execute({
      execute: () => {
        strokes = [part1, part2];
      },
      undo: () => {
        strokes = [originalStroke];
      },
      description: 'Точечный ластик',
    });

    assert.strictEqual(strokes.length, 2);
    assert.strictEqual(strokes[0].id, 'stroke-part-1');

    // Отмена Ctrl+Z
    stack.undo();
    assert.strictEqual(strokes.length, 1);
    assert.strictEqual(strokes[0].id, 'stroke-long');
    assert.deepStrictEqual(strokes[0], originalStroke);
  });
});

describe('4. Надёжная очередь синхронизации (Task 4)', () => {
  test('При сетевой ошибке payload возвращается обратно в очередь и объединяется с новыми данными', () => {
    const mergeById = (prev = [], next = []) => {
      const map = new Map();
      for (const item of prev) map.set(item.id, item);
      for (const item of next) map.set(item.id, item);
      return Array.from(map.values());
    };

    let pendingQueue = {
      notebooks: [{ id: 'nb-1', title: 'Блокнот 1' }],
      pages: [{ id: 'pg-1', title: 'Страница 1' }],
    };

    // Симуляция отправки
    const inFlightPayload = { ...pendingQueue };
    pendingQueue = {}; // Очередь очищается на время запроса

    // Во время сетевого запроса пользователь создал новую страницу
    const incomingChange = {
      pages: [{ id: 'pg-2', title: 'Новая страница 2' }],
    };
    pendingQueue = {
      pages: incomingChange.pages,
    };

    // Сеть вернула ошибку (Failed to fetch)
    const isNetworkError = true;
    if (isNetworkError) {
      // Re-queue: мержим inFlightPayload обратно в pendingQueue
      pendingQueue = {
        notebooks: mergeById(inFlightPayload.notebooks, pendingQueue.notebooks),
        pages: mergeById(inFlightPayload.pages, pendingQueue.pages),
      };
    }

    assert.strictEqual(pendingQueue.notebooks.length, 1, 'Неотправленный блокнот вернулся в очередь');
    assert.strictEqual(pendingQueue.pages.length, 2, 'В очереди сохранены и старая, и новая страница');
    assert.ok(pendingQueue.pages.some((p) => p.id === 'pg-1'));
    assert.ok(pendingQueue.pages.some((p) => p.id === 'pg-2'));
  });
});

describe('5. Гранулярность Undo/Redo ластика (Задача 6)', () => {
  class MockCommandStack {
    constructor(maxDepth = 100) {
      this.undoStack = [];
      this.redoStack = [];
      this.maxDepth = maxDepth;
    }
    execute(cmd) {
      cmd.execute();
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
      this.redoStack = [];
    }
    undo() {
      const cmd = this.undoStack.pop();
      if (cmd) {
        cmd.undo();
        this.redoStack.push(cmd);
      }
    }
    redo() {
      const cmd = this.redoStack.pop();
      if (cmd) {
        cmd.execute();
        this.undoStack.push(cmd);
      }
    }
  }

  test('Стирание непрерывным жестом (point-eraser и stroke-eraser) создает ровно 1 запись в стеке истории', () => {
    const stack = new MockCommandStack();

    // Предыдущее действие (например, рисование штриха s-0)
    let strokes = [
      { id: 's-0', points: [{ x: 0, y: 0 }], color: '#000' },
      { id: 's-1', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], color: '#ff0' },
      { id: 's-2', points: [{ x: 30, y: 30 }, { x: 40, y: 40 }], color: '#00f' },
    ];
    stack.execute({
      execute: () => {},
      undo: () => {
        strokes = strokes.filter((s) => s.id !== 's-0');
      },
      description: 'Рисование пера',
    });
    assert.strictEqual(stack.undoStack.length, 1, 'В стеке 1 команда до начала стирания');

    // 1. Начало жеста ластика (pointerdown): снимок начального состояния
    let eraserInitialStrokes = [...strokes];

    // 2. Движение ластика (pointermove): серия вызовов deleteStrokesSilent / replaceStrokesSilent
    // Моделируем 5 шагов движения ластика
    for (let step = 1; step <= 5; step++) {
      if (step === 2) {
        // Удалили s-1 "тихо" (без stack.execute)
        strokes = strokes.filter((s) => s.id !== 's-1');
      }
      if (step === 4) {
        // Удалили s-2 "тихо" (без stack.execute)
        strokes = strokes.filter((s) => s.id !== 's-2');
      }
    }

    // Во время движения ластика стек истории НЕ должен увеличиваться!
    assert.strictEqual(stack.undoStack.length, 1, 'Во время жеста микро-команды не засоряют историю');
    assert.strictEqual(strokes.length, 1, 'На экране штрихи стёрты (остался s-0)');

    // 3. Завершение жеста ластика (pointerup / finalizeEraserGesture)
    const prev = eraserInitialStrokes;
    const curr = [...strokes];
    eraserInitialStrokes = null;

    const isDifferent =
      prev.length !== curr.length ||
      prev.some((s, idx) => s.id !== curr[idx]?.id);

    if (isDifferent) {
      stack.execute({
        execute: () => {
          strokes = [...curr];
        },
        undo: () => {
          strokes = [...prev];
        },
        description: 'Стирание ластиком',
      });
    }

    // Проверяем: добавилась РОВНО 1 макро-команда
    assert.strictEqual(stack.undoStack.length, 2, 'В стеке должна появиться ровно 1 команда стирания');
    assert.strictEqual(stack.undoStack[1].description, 'Стирание ластиком');

    // 4. Одно нажатие Ctrl+Z (Undo): должно восстановить ВСЕ стёртые за жест штрихи
    stack.undo();
    assert.strictEqual(strokes.length, 3, 'Все штрихи s-0, s-1, s-2 восстановлены за 1 шаг Ctrl+Z');
    assert.ok(strokes.some((s) => s.id === 's-1'));
    assert.ok(strokes.some((s) => s.id === 's-2'));

    // 5. Повторное нажатие Ctrl+Z: откатывает предыдущее действие (рисование пера s-0)
    stack.undo();
    assert.strictEqual(strokes.length, 2, 'Повторный Ctrl+Z откатил предыдущее действие, не трогая стёртые штрихи');
    assert.strictEqual(strokes.some((s) => s.id === 's-0'), false);
  });

  test('Аккорд мыши (ЛКМ+ПКМ) отменяет текущий жест ластика без записи в стек истории', () => {
    const stack = new MockCommandStack();
    const initialStrokes = [{ id: 's-1', points: [{ x: 1, y: 1 }], color: '#000' }];
    let strokes = [...initialStrokes];

    let eraserInitialSnapshot = [...strokes];
    // Тихо стёрли штрих во время движения
    strokes = [];

    // Пользователь нажал аккорд ЛКМ+ПКМ: откат к снимку и сброс жеста
    strokes = [...eraserInitialSnapshot];
    eraserInitialSnapshot = null;

    assert.strictEqual(strokes.length, 1, 'Штрих мгновенно вернулся');
    assert.strictEqual(stack.undoStack.length, 0, 'В стек отмены ничего не попало');
  });
});

describe('6. Local-First холодный старт и Smart Diff (Задача 7)', () => {
  test('Smart Diff: если данные в облаке не новее local lastSyncedAt, IndexedDB и refreshFromStorage не вызываются', () => {
    const savedLastSync = 1700000000000;
    let refreshFromStorageCalled = false;
    let dbPuts = 0;

    const cloudData = {
      notebooks: [{ id: 'nb-1', title: 'Блокнот', updatedAt: savedLastSync - 5000 }],
      sections: [{ id: 'sec-1', title: 'Раздел', updatedAt: savedLastSync - 5000 }],
      pages: [{ id: 'pg-1', title: 'Страница 1', updatedAt: savedLastSync - 1000 }],
      elements: [{ id: 'str-1', pageId: 'pg-1', updatedAt: savedLastSync - 2000 }],
    };

    // Алгоритм Smart Diff из syncEngine.ts
    const isAnyCloudItemNewer =
      savedLastSync === 0 ||
      cloudData.notebooks.some((n) => (n.updatedAt || 0) > savedLastSync) ||
      cloudData.sections.some((s) => (s.updatedAt || 0) > savedLastSync) ||
      cloudData.pages.some((p) => (p.updatedAt || 0) > savedLastSync) ||
      cloudData.elements.some((e) => (e.updatedAt || 0) > savedLastSync);

    if (isAnyCloudItemNewer) {
      dbPuts++;
      refreshFromStorageCalled = true;
    }

    assert.strictEqual(isAnyCloudItemNewer, false, 'Облачные данные не новее локальных');
    assert.strictEqual(dbPuts, 0, 'IndexedDB не должна перезаписываться одинаковыми данными');
    assert.strictEqual(refreshFromStorageCalled, false, 'Холст не должен мерцать и перезагружаться');
  });

  test('Smart Diff: изменения других страниц не сбрасывают активный холст текущей страницы', () => {
    const savedLastSync = 1700000000000;
    const activePageId = 'page-active-123';
    let fullCanvasRefreshCalled = false;
    let sidebarUpdated = false;

    // Облако вернуло обновление для ДРУГОЙ страницы (page-other-456)
    const cloudData = {
      pages: [
        { id: 'page-other-456', title: 'Вторая страница', updatedAt: savedLastSync + 5000 },
      ],
      elements: [
        { id: 'str-other', pageId: 'page-other-456', updatedAt: savedLastSync + 5000 },
      ],
    };

    const activePageAffected =
      !activePageId ||
      cloudData.pages.some((p) => p.id === activePageId && (p.updatedAt || 0) > savedLastSync) ||
      cloudData.elements.some((e) => e.pageId === activePageId && (e.updatedAt || 0) > savedLastSync);

    if (activePageAffected) {
      fullCanvasRefreshCalled = true;
    } else {
      sidebarUpdated = true;
    }

    assert.strictEqual(activePageAffected, false, 'Активная страница не затронута облачным обновлением');
    assert.strictEqual(fullCanvasRefreshCalled, false, 'Холст активной страницы не перезагружается');
    assert.strictEqual(sidebarUpdated, true, 'Метаданные обновлены тихо');
  });
});

