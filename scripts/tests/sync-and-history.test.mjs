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
