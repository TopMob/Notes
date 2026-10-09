import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function loadModule(filename, boundaries = {}, cache = new Map()) {
  const path = resolve(filename); if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} }; cache.set(path, module);
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = name => Object.hasOwn(boundaries, name) ? boundaries[name] : name.endsWith('.mjs') ? require(resolve(dirname(path), name)) : name.startsWith('.') ? loadModule(resolve(dirname(path), `${name}.ts`), boundaries, cache) : require(name);
  Function('require', 'module', 'exports', js)(localRequire, module, module.exports); return module.exports;
}
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const empty = () => ({ notebooks: [], sections: [], pages: [], elements: [] });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function engineFixture(overrides = {}, localTables = {}) {
  const queued = new Map(); const records = new Map(); let revision = 0;
  const enqueue = (entity, entityId, record, action = 'put') => {
    const key = `${entity}:${entityId}`;
    if (record) records.set(key, record);
    queued.set(key, { key, entity, entityId, action, userId: 'user', provider: 'turso', sessionId: 'fixture-session', operationId: String(++revision) });
  };
  const provider = { pushNotebooks: async () => {}, pushSections: async () => {}, pushPages: async () => {}, pushPageElements: async () => {}, deleteItems: async () => {}, pullAll: async () => empty(), ...overrides };
  const canvas = { currentPageId: 'p', saveStatus: 'saved', flushAllSaves: async () => {}, getUnsavedPageIds: () => [], getEditRevision: () => 0 };
  const stats = { notebooks: 0, sections: 0, pages: 0, elements: 0 };
  let applies = 0, refreshes = 0;
  const api = loadModule('src/services/sync/syncEngine.ts', {
    './tursoProvider': { TursoProvider: class { constructor() { return provider; } } },
    './supabaseProvider': { SupabaseProvider: class { setTokenProvider() {} } },
    '../../db/idb': { getDB: async () => ({ getAll: async name => localTables[name] || [], transaction: () => ({ done: Promise.resolve() }) }) },
    '../../db/storage': { loadPageData: async () => ({ strokes: [], shapes: [], textBlocks: [] }) },
    '../../store/useCanvasStore': { useCanvasStore: { getState: () => canvas, setState() { throw Error('Do not replace active canvas directly'); } } },
    '../../store/useNotebookStore': { useNotebookStore: { getState: () => ({ refreshFromStorage: async () => { refreshes++; } }) } },
    './safePull': { validateCloudPull() {}, applyCloudPull: async () => { applies++; return { pulled: stats, conflicts: new Set() }; } },
    './outboxContext': { isSyncOwner: () => true, rememberSyncOwner() {} },
    './outbox': {
      outboxSessionId: 'fixture-session',
      pendingOutbox: async binding => [...queued.values()].filter(entry => entry.userId === binding.userId && entry.provider === binding.provider),
      acknowledgeOutbox: async entry => { if (queued.get(entry.key)?.operationId === entry.operationId) queued.delete(entry.key); },
      queueLocalChange: async (_tx, entity, id) => enqueue(entity, id, localTables[entity]?.find(row => row.id === id)),
      readOutboxSnapshot: async entry => {
        if (queued.get(entry.key)?.operationId !== entry.operationId) return null;
        const record = records.get(entry.key);
        return { entry, record, [entry.entity === 'notebooks' ? 'notebook' : entry.entity === 'sections' ? 'section' : 'page']: record, elements: { strokes: [], shapes: [], textBlocks: [] } };
      },
    },
  });
  const notify = api.syncEngine.notifyChange.bind(api.syncEngine);
  api.syncEngine.notifyChange = payload => {
    for (const entity of ['notebooks', 'sections', 'pages']) for (const record of payload[entity] || []) enqueue(entity, record.id, record);
    notify(payload);
  };
  return { ...api, canvas, queued, counts: () => ({ applies, refreshes }) };
}

test('duplicate full sync requests share one actual operation', async () => {
  const gate = deferred(); let pulls = 0;
  const { syncEngine, useSyncStore, counts } = engineFixture({ pullAll: async () => { pulls++; await gate.promise; return empty(); } });
  useSyncStore.setState({ userId: 'user' });
  const first = syncEngine.syncAll(); const second = syncEngine.syncAll();
  assert.equal(first, second); gate.resolve(); await first;
  assert.equal(pulls, 1); assert.deepEqual(counts(), { applies: 1, refreshes: 0 });
});

test('a failed queued push prevents PULL and retries the original payload', async () => {
  let failed = true, pulls = 0, pushes = 0;
  const { syncEngine, useSyncStore, counts } = engineFixture({ pushNotebooks: async () => { pushes++; if (failed) throw Error('Network failure'); }, pullAll: async () => { pulls++; return empty(); } });
  syncEngine.notifyChange({ notebooks: [{ id: 'n', title: 'Keep', order: 0, createdAt: 1 }] });
  useSyncStore.setState({ userId: 'user' });
  await assert.rejects(syncEngine.syncAll(), /Network failure/);
  assert.equal(pulls, 0); assert.equal(counts().applies, 0);
  failed = false; assert.equal(await syncEngine.flushPendingChanges(), true); assert.equal(pushes, 2);
});

test('a new cloud page whose content upload fails remains queued for retry', async () => {
  let failed = true, pagePushes = 0, elementPushes = 0;
  const { syncEngine, useSyncStore } = engineFixture({ pushPages: async () => { pagePushes++; }, pushPageElements: async () => { elementPushes++; if (failed) throw Error('Content upload failure'); } }, { pages: [{ id: 'p' }] });
  useSyncStore.setState({ userId: 'user' }); await assert.rejects(syncEngine.syncAll(), /Content upload failure/);
  failed = false; assert.equal(await syncEngine.flushPendingChanges(), true);
  assert.equal(pagePushes, 2); assert.equal(elementPushes, 2);
});

test('background pushes are serialized even when changes arrive in flight', async () => {
  const gate = deferred(); let active = 0, maximum = 0; const sent = [];
  const { syncEngine, useSyncStore } = engineFixture({ pushNotebooks: async (_user, rows) => { active++; maximum = Math.max(maximum, active); sent.push(rows[0].title); if (sent.length === 1) await gate.promise; active--; } });
  syncEngine.notifyChange({ notebooks: [{ id: 'n', title: 'First', order: 0, createdAt: 1 }] });
  useSyncStore.setState({ userId: 'user' }); const first = syncEngine.flushPendingChanges();
  await new Promise(resolve => setImmediate(resolve));
  syncEngine.notifyChange({ notebooks: [{ id: 'n', title: 'Second', order: 0, createdAt: 1 }] });
  const second = syncEngine.flushPendingChanges(); gate.resolve(); await Promise.all([first, second]);
  assert.equal(maximum, 1); assert.deepEqual(sent, ['First', 'Second']);
});

test('editing while waiting for the cloud prevents applying the late response', async () => {
  const gate = deferred(); const { syncEngine, useSyncStore, canvas, counts } = engineFixture({ pullAll: () => gate.promise });
  useSyncStore.setState({ userId: 'user' }); const syncing = syncEngine.syncAll();
  await new Promise(resolve => setImmediate(resolve)); canvas.getEditRevision = () => 1;
  gate.resolve(empty()); await assert.rejects(syncing, /локальные правки/); assert.equal(counts().applies, 0);
});

test('switching account while awaiting cloud never applies the old account response', async () => {
  const gate = deferred(); const { syncEngine, useSyncStore, counts } = engineFixture({ pullAll: () => gate.promise });
  useSyncStore.setState({ userId: 'first' }); const syncing = syncEngine.syncAll();
  await new Promise(resolve => setImmediate(resolve)); useSyncStore.setState({ userId: 'second' });
  gate.resolve(empty()); await assert.rejects(syncing, /Аккаунт/); assert.equal(counts().applies, 0);
});

function notebookFixture(boundaries = {}) {
  const page = { id: 'p', sectionId: 's', title: 'Stored note', order: 0, createdAt: 1, camera: { x: 0, y: 0, zoom: 1 }, background: 'plain' };
  const sections = [{ id: 'empty-s', notebookId: 'empty', title: 'Empty section' }, { id: 's', notebookId: 'real', title: 'Real section' }];
  const loaded = [];
  const { useNotebookStore } = loadModule('src/store/useNotebookStore.ts', {
    '../db/storage': { initStorage: async () => {}, loadNotebooks: async () => [{ id: 'empty' }, { id: 'real' }], loadAllPages: async () => [page],
      loadSections: async id => sections.filter(s => s.notebookId === id), loadPages: async id => id === 's' ? [page] : [], updatePageMetadata: async () => { throw Error('Quota full during optional slug update'); }, ...boundaries },
    '../db/idb': { getDB: async () => { throw Error('Unexpected database access'); } },
    './useCanvasStore': { useCanvasStore: { getState: () => ({ loadPage: async id => { loaded.push(id); } }) } },
  });
  return { useNotebookStore, loaded };
}

test('startup selects existing notes beyond an empty first notebook despite slug write failure', async () => {
  const { useNotebookStore, loaded } = notebookFixture(); await useNotebookStore.getState().init();
  assert.deepEqual(loaded, ['p']); assert.equal(useNotebookStore.getState().activeNotebook.id, 'real');
  assert.equal(useNotebookStore.getState().loadError, null); assert.equal(useNotebookStore.getState().isLoading, false);
});

test('startup read failure is visible and retryable rather than an endless loading screen', async () => {
  let fail = true;
  const { useNotebookStore } = notebookFixture({ initStorage: async () => { if (fail) throw Error('Temporary IndexedDB read failure'); } });
  await useNotebookStore.getState().init(); assert.ok(useNotebookStore.getState().loadError); assert.equal(useNotebookStore.getState().isLoading, false);
  fail = false; await useNotebookStore.getState().init(); assert.equal(useNotebookStore.getState().loadError, null); assert.equal(useNotebookStore.getState().activePage.id, 'p');
});

test('Supabase reads beyond a truncated server page until the terminal empty page', async () => {
  const { readSupabaseRows } = loadModule('src/services/sync/supabaseRead.ts');
  const pages = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], []]; const cursors = [];
  const client = { from() {
    const query = { select() { return this; }, eq() { return this; }, gt(column, value) { if (column === 'id') cursors.push(value); return this; }, order() { return this; }, limit() { return this; }, then(resolve) { return Promise.resolve({ data: pages.shift(), error: null }).then(resolve); } }; return query;
  } };
  assert.deepEqual((await readSupabaseRows(client, 'pages', 'user', 0)).map(row => row.id), ['a', 'b', 'c']);
  assert.deepEqual(cursors, ['b', 'c']);
});

test('Supabase failure on a later page rejects the entire partial result', async () => {
  const { readSupabaseRows } = loadModule('src/services/sync/supabaseRead.ts'); let calls = 0;
  const client = { from() { return { select() { return this; }, eq() { return this; }, gt() { return this; }, order() { return this; }, limit() { return this; }, then(resolve) { return Promise.resolve(++calls === 1 ? { data: [{ id: 'a' }], error: null } : { data: null, error: Error('Second page failure') }).then(resolve); } }; } };
  await assert.rejects(readSupabaseRows(client, 'pages', 'user', 0), /Second page failure/);
});

test('remembered local owner remains stable through signout, account and provider changes', () => {
  const original = globalThis.localStorage; const data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  try {
    const context = loadModule('src/services/sync/outboxContext.ts');
    assert.equal(context.getSyncBinding().userId, null);
    context.rememberSyncOwner('first'); context.rememberSyncOwner(null); context.rememberSyncOwner('second');
    assert.equal(context.getSyncBinding().userId, 'first'); assert.equal(context.isSyncOwner('second'), false);
    data.set('onenote_sync_provider', 'supabase'); assert.equal(context.getSyncBinding().provider, 'supabase');
    data.set('onenote_sync_provider', 'local'); assert.equal(context.getSyncBinding(), null);
  } finally { globalThis.localStorage = original; }
});

test('replaying an interrupted session never replaces differing existing cloud content', () => {
  const { checkOutboxReplay } = loadModule('src/services/sync/replaySafety.ts');
  const record = { id: 'p', title: 'Local', order: 0, sectionId: 's', camera: { x: 0, y: 0, zoom: 1 }, background: 'plain' };
  const snapshot = { entry: { entity: 'pages', entityId: 'p', action: 'put' }, record, elements: { strokes: [{ id: 'a', pageId: 'p', color: 'black' }], shapes: [], textBlocks: [] } };
  const cloud = { ...empty(), pages: [record], elements: [{ id: 'a', pageId: 'p', type: 'stroke', data: { id: 'a', pageId: 'p', color: 'red' } }] };
  assert.equal(checkOutboxReplay(snapshot, cloud), 'conflict');
  cloud.elements[0].data.color = 'black'; assert.equal(checkOutboxReplay(snapshot, cloud), 'acknowledged');
  assert.equal(checkOutboxReplay(snapshot, empty()), 'new');
  snapshot.entry.action = 'delete'; assert.equal(checkOutboxReplay(snapshot, cloud), 'conflict');
  cloud.pages[0] = { ...record, deletedAt: 10 }; assert.equal(checkOutboxReplay(snapshot, cloud), 'acknowledged');
});

test('actual engine pauses restored conflicting work without calling a cloud write', async () => {
  let pushes = 0;
  const { syncEngine, useSyncStore, queued } = engineFixture({ pushNotebooks: async () => { pushes++; }, pullAll: async () => ({ ...empty(), notebooks: [{ id: 'n', title: 'Remote', order: 0, createdAt: 1, updatedAt: 10 }] }) });
  syncEngine.notifyChange({ notebooks: [{ id: 'n', title: 'Local', order: 0, createdAt: 1 }] });
  queued.values().next().value.sessionId = 'previous-session';
  useSyncStore.setState({ userId: 'user' });
  await assert.rejects(syncEngine.syncAll(), /до выбора версии/);
  assert.equal(pushes, 0); assert.equal(queued.size, 1);
});
