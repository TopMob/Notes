import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

// Execute entire actual TS modules. Only IO boundaries are replaced; no copied algorithms.
function loadModule(filename, boundaries = {}, cache = new Map()) {
  const path = resolve(filename);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} }; cache.set(path, module);
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = name => {
    if (Object.hasOwn(boundaries, name)) return boundaries[name];
    if (name.endsWith('.mjs')) return require(resolve(dirname(path), name));
    if (name.startsWith('.')) return loadModule(resolve(dirname(path), `${name}.ts`), boundaries, cache);
    return require(name);
  };
  Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
  return module.exports;
}
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const stroke = (id = 's', color = 'black') => ({ id, pageId: 'p', tool: 'pen', color, points: [{ x: 1, y: 2, pressure: .5, t: 0 }], baseWidth: 3, opacity: 1, blendMode: 'source-over', bounds: { minX: 1, minY: 2, maxX: 1, maxY: 2 }, createdAt: 0 });
function canvas(write, load = async () => ({ strokes: [], shapes: [], textBlocks: [] })) {
  const { useCanvasStore: store, registerCanvasPageLeave } = loadModule('src/store/useCanvasStore.ts', { '../db/storage': { savePageDiff: write, savePageFull: write, loadPageData: load } });
  store.registerPageLeave = registerCanvasPageLeave;
  store.setState({ currentPageId: 'p' }); return store;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('failed local save retains edits, reports error and retries actual diff', async () => {
  const writes = []; let fail = true;
  const store = canvas(async (_, diff) => { writes.push(diff); if (fail) throw Error('QuotaExceededError'); });
  store.getState().addStroke(stroke());
  assert.equal(store.getState().saveStatus, 'unsaved');
  await assert.rejects(store.getState().flushSave());
  assert.equal(store.getState().saveStatus, 'error'); assert.ok(store.getState().saveError);
  await assert.rejects(store.getState().loadPage('other')); assert.equal(store.getState().currentPageId, 'p');
  fail = false; await store.getState().flushAllSaves();
  assert.equal(store.getState().saveStatus, 'saved'); assert.equal(store.getState().saveError, null);
  assert.equal(writes.at(-1).strokes.put[0].id, 's');
});

test('new deletion wins over failed older put', async () => {
  const gate = deferred(); const writes = [];
  const store = canvas(async (_, diff) => { writes.push(diff); if (writes.length === 1) await gate.promise; });
  store.getState().addStroke(stroke());
  const saving = store.getState().flushSave();
  store.getState().deleteStrokesSilent(['s']);
  gate.reject(Error('storage abort')); await assert.rejects(saving);
  await store.getState().flushAllSaves();
  assert.deepEqual(writes[1].strokes.deleteIds, ['s']); assert.equal(writes[1].strokes.put, undefined);
});

test('newer put wins over failed deletion, and metadata merges by newest fields', async () => {
  const gate = deferred(); const writes = [];
  const store = canvas(async (_, diff) => { writes.push(diff); if (writes.length === 1) await gate.promise; });
  store.setState({ strokes: [stroke()] });
  store.getState().deleteStrokesSilent(['s']); store.getState().setBackground('ruled');
  const saving = store.getState().flushSave();
  store.getState().restoreStrokesWithDirty([stroke('s', 'red')]); store.getState().setCamera({ x: 4, y: 5, zoom: 2 });
  gate.reject(Error('storage abort')); await assert.rejects(saving);
  await store.getState().flushAllSaves();
  assert.equal(writes[1].strokes.put[0].color, 'red'); assert.equal(writes[1].strokes.deleteIds, undefined);
  assert.equal(writes[1].metadata.background, 'ruled'); assert.equal(writes[1].metadata.camera.zoom, 2);
});

test('concurrent flushes are serialized; successful old save cannot mark new edits saved', async () => {
  const gate = deferred(); const writes = []; let active = 0, maximum = 0;
  const store = canvas(async (_, diff) => { active++; maximum = Math.max(maximum, active); writes.push(diff); if (writes.length === 1) await gate.promise; active--; });
  store.getState().addStroke(stroke('one'));
  const first = store.getState().flushSave();
  store.getState().addStroke(stroke('two'));
  gate.resolve(); await first;
  assert.equal(store.getState().saveStatus, 'unsaved');
  await Promise.all([store.getState().flushSave(), store.getState().flushSave(), store.getState().flushSave()]);
  assert.equal(maximum, 1); assert.equal(writes.length, 2); assert.equal(writes[1].strokes.put[0].id, 'two');
  assert.equal(store.getState().saveStatus, 'saved');
});

test('continuous input is locally flushed within maximum wait', async () => {
  let writes = 0;
  const store = canvas(async () => { writes++; });
  const start = Date.now();
  const interval = setInterval(() => store.getState().setCamera({ x: Date.now(), y: 0, zoom: 1 }), 100);
  try {
    while (!writes && Date.now() - start < 3000) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(writes > 0, 'continuous edits must not postpone saving forever');
  } finally { clearInterval(interval); await store.getState().flushAllSaves(); }
});

function storage(db) {
  return loadModule('src/db/storage.ts', { './idb': { getDB: async () => db }, '../services/sync/syncEngine': { syncEngine: { notifyChange() {}, notifyDelete() {} } }, '../services/assets/assetManager': { assetManager: { registerAsset() {} } } });
}
test('legacy notebook alongside real notes never causes clear or reseeding', async () => {
  let clears = 0, writes = 0;
  const db = { getAll: async name => name === 'notebooks' ? [{ id: 'nb-college' }, { id: 'real' }] : [], count: async () => 0, transaction: () => { throw Error('Should not reseed'); }, put: async () => { writes++; }, clear: async () => { clears++; } };
  await storage(db).initStorage(); assert.equal(clears, 0); assert.equal(writes, 0);
});

test('orphan data without notebooks must not be overwritten by initial defaults', async () => {
  const orphan = { id: 'orphan', title: 'Keep me' };
  const db = { getAll: async name => name === 'pages' ? [orphan] : [], count: async () => 1, transaction: () => { throw Error('Should not reseed'); }, put: async () => { throw Error('Should not guess a parent'); } };
  await storage(db).initStorage();
  assert.equal(orphan.sectionId, undefined);
});

test('invalid or incomplete import is rejected before even opening IndexedDB', async () => {
  const api = storage({ transaction: () => { throw Error('Must not open transaction'); } });
  for (const raw of [{ data: {} }, { version: 1, data: {} }, { version: 99, data: {} }]) await assert.rejects(api.importFullBackup(JSON.stringify(raw)), /Некорректная/);
});

test('valid legacy structure retains aliases/trash; duplicate IDs and broken relations reject', () => {
  const { validateLegacyBackup } = loadModule('src/db/backupValidation.ts');
  const data = { notebooks: [{ id: 'n', title: 'Notebook', order: 0, createdAt: 0 }], sections: [{ id: 'sec', notebookId: 'n', title: 'Section', color: 'red', order: 0 }], pages: [{ id: 'p', sectionId: 'sec', title: 'Page', createdAt: 0, order: 0, camera: { x: 0, y: 0, zoom: 1 }, background: 'plain', slugAliases: ['old'], deletedAt: 1 }], strokes: [stroke()], shapes: [], textBlocks: [] };
  assert.deepEqual(validateLegacyBackup({ version: 1, data }).data.pages[0].slugAliases, ['old']);
  const duplicate = structuredClone(data); duplicate.pages.push(data.pages[0]); assert.throws(() => validateLegacyBackup({ version: 1, data: duplicate }));
  const orphan = structuredClone(data); orphan.pages[0].sectionId = 'missing'; assert.throws(() => validateLegacyBackup({ version: 1, data: orphan }));
});

test('image persistence failure revokes temporary URL and never reports success', async () => {
  const originalRevoke = URL.revokeObjectURL; const revoked = [];
  URL.revokeObjectURL = url => { revoked.push(url); originalRevoke(url); };
  const { assetManager } = loadModule('src/services/assets/assetManager.ts', { '../../db/idb': { getDB: async () => ({ put: async () => { throw Error('QuotaExceededError'); } }) }, './imageCompression': {} });
  try {
    await assert.rejects(assetManager.saveAsset(new Blob(['image']), 'p'), /Не удалось сохранить изображение/);
    assert.equal(revoked.length, 1);
  } finally { URL.revokeObjectURL = originalRevoke; }
});

test('reloading the same page first saves pending edits', async () => {
  const persisted = [];
  const store = canvas(async (_, diff) => persisted.push(...diff.strokes.put), async () => ({ strokes: persisted, shapes: [], textBlocks: [] }));
  store.getState().addStroke(stroke()); await store.getState().loadPage('p');
  assert.equal(store.getState().strokes[0].id, 's'); assert.equal(store.getState().saveStatus, 'saved');
});

test('edits made while loading a page survive the late response', async () => {
  const gate = deferred(); const store = canvas(async () => {}, () => gate.promise);
  const loading = store.getState().loadPage('other');
  await new Promise(resolve => setImmediate(resolve));
  store.getState().addStroke(stroke('during-load'));
  await store.getState().flushAllSaves();
  gate.resolve({ strokes: [], shapes: [], textBlocks: [] }); await assert.rejects(loading, /новые правки/);
  assert.equal(store.getState().currentPageId, 'p'); assert.equal(store.getState().strokes[0].id, 'during-load');
  await store.getState().flushAllSaves();
});

test('an older page load cannot overwrite a newer transition', async () => {
  const gate = deferred(); const store = canvas(async () => {}, id => id === 'old' ? gate.promise : Promise.resolve({ strokes: [], shapes: [], textBlocks: [] }));
  const old = store.getState().loadPage('old'); await new Promise(resolve => setImmediate(resolve));
  await store.getState().loadPage('new'); gate.resolve({ strokes: [], shapes: [], textBlocks: [] });
  await assert.rejects(old, /новым переходом/); assert.equal(store.getState().currentPageId, 'new');
});

test('page transition finishes and persists the active gesture on its original page', async () => {
  const writes = [], store = canvas(async (id, diff) => writes.push({ id, diff }));
  let active = true;
  const unregister = store.registerPageLeave(() => { if (active) { active = false; store.getState().addStroke(stroke('unfinished')); } });
  try {
    await store.getState().loadPage('new');
    assert.equal(writes[0].id, 'p');
    assert.equal(writes[0].diff.strokes.put[0].pageId, 'p');
    assert.equal(store.getState().currentPageId, 'new');
    assert.deepEqual(store.getState().strokes, []);
  } finally { unregister(); }
});

test('stale callbacks cannot insert objects from the previous page into a new canvas', async () => {
  const writes = [], store = canvas(async (id, diff) => writes.push({ id, diff }));
  await store.getState().loadPage('new');
  store.getState().addStroke(stroke('stale'));
  store.getState().addShape({ id: 'stale-shape', pageId: 'p' });
  store.getState().addTextBlock({ id: 'stale-text', pageId: 'p' });
  assert.deepEqual(store.getState().strokes, []);
  assert.deepEqual(store.getState().shapes, []);
  assert.deepEqual(store.getState().textBlocks, []);
  await store.getState().flushAllSaves();
  assert.equal(writes.length, 0);
});

test('a stroke still held by the pen protects its page from incoming sync before pointerup', async () => {
  const store = canvas(async () => {}), before = store.getState().getEditRevision();
  store.getState().beginInteraction();
  assert.ok(store.getState().getEditRevision() > before);
  assert.deepEqual(store.getState().getUnsavedPageIds(), ['p']);
  await store.getState().flushAllSaves();
  assert.deepEqual(store.getState().getUnsavedPageIds(), ['p']);
  store.getState().endInteraction();
  assert.deepEqual(store.getState().getUnsavedPageIds(), []);
});

test('four-quadrant axes render and erase on both sides of the origin, including reversed drags', () => {
  const { drawShapeToCanvas, isShapeHitByEraser, computeShapeBounds } = loadModule('src/canvas/stroke/shapes.ts');
  const anchor = { x: 0, y: 0 }, end = { x: 200, y: 160 };
  const shape = { id: 'axis', pageId: 'p', type: 'axis', axisMode: 'four-quadrant', anchor, end, style: { color: 'black', width: 2 }, bounds: computeShapeBounds(anchor, end) };
  const lines = []; let path;
  const ctx = { save() {}, restore() {}, setLineDash() {}, beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); }, stroke() { lines.push(path); }, closePath() {}, fill() {} };
  drawShapeToCanvas(ctx, shape);
  assert.deepEqual(lines, [[[100, 160], [100, 0]], [[0, 80], [200, 80]]]);
  for (const center of [{ x: 25, y: 80 }, { x: 175, y: 80 }, { x: 100, y: 25 }, { x: 100, y: 140 }]) assert.ok(isShapeHitByEraser(shape, center, 2));
  assert.equal(isShapeHitByEraser(shape, { x: 25, y: 25 }, 2), false);
  lines.length = 0;
  drawShapeToCanvas(ctx, { ...shape, anchor: end, end: anchor });
  assert.deepEqual(lines, [[[100, 160], [100, 0]], [[0, 80], [200, 80]]]);
  lines.length = 0;
  drawShapeToCanvas(ctx, { ...shape, axisMode: undefined });
  assert.deepEqual(lines, [[[0, 160], [0, 0]], [[0, 160], [200, 160]]], 'old graph origins must stay aligned');
});
