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
function conflictFixture() {
  const binding = { provider: 'turso', userId: 'user' };
  const page = { id: 'p', sectionId: 's', title: 'Page', order: 0, createdAt: 1, updatedAt: 1, camera: { x: 0, y: 0, zoom: 1 }, background: 'plain' };
  const stroke = { id: 'a', pageId: 'p', points: [{ x: 0, y: 0 }], tool: 'pen', color: 'black', baseWidth: 2, opacity: 1, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, createdAt: 1 };
  const tables = { notebooks: [{ id: 'n', title: 'Notebook', order: 0, createdAt: 1, updatedAt: 1 }], sections: [{ id: 's', notebookId: 'n', title: 'Section', color: 'blue', order: 0, updatedAt: 1 }], pages: [structuredClone(page)], strokes: [structuredClone(stroke)], shapes: [], textBlocks: [], syncOutbox: [], assets: [] };
  const keyOf = row => row.key ?? row.id;
  const store = name => ({
    getAll: async () => structuredClone(tables[name]),
    get: async id => structuredClone(tables[name].find(row => keyOf(row) === id)),
    put: async row => { const i = tables[name].findIndex(old => keyOf(old) === keyOf(row)); if (i < 0) tables[name].push(structuredClone(row)); else tables[name][i] = structuredClone(row); },
    delete: async id => { tables[name] = tables[name].filter(row => keyOf(row) !== id); },
    index: () => ({ getAll: async id => structuredClone(tables[name].filter(row => row.pageId === id)) }),
  });
  const db = { getAll: name => store(name).getAll(), get: (name, id) => store(name).get(id), transaction: names => ({ objectStore: store, store: store(typeof names === 'string' ? names : names[0]), done: Promise.resolve() }) };
  const state = { key: JSON.stringify(['state', 'turso', 'user', 'pages', 'p']), provider: 'state', bindingProvider: 'turso', userId: 'user', entity: 'pages', entityId: 'p', base: null, conflict: true };
  tables.syncOutbox.push(state);
  const cloud = { notebooks: structuredClone(tables.notebooks), sections: structuredClone(tables.sections), pages: [page], elements: [{ id: 'a', pageId: 'p', type: 'stroke', data: stroke, updatedAt: 1 }], completePageIds: ['p'] };
  return { db, tables, cloud, binding, state };
}
const empty = () => ({ notebooks: [], sections: [], pages: [], elements: [] });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function engineFixture(overrides = {}, localTables = {}, database, boundaries = {}) {
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
    '../../db/idb': { getDB: async () => database || ({ getAll: async name => localTables[name] || [], transaction: () => ({ done: Promise.resolve() }) }) },
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
    ...boundaries,
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

test('camera-only viewport updates do not enter sync outbox or notify syncEngine', async () => {
  let notified = 0;
  const queued = [];
  const fakeTx = {
    objectStore: () => ({
      get: async () => ({ id: 'p', sectionId: 's', title: 'Page', camera: { x: 0, y: 0, zoom: 1 } }),
      put: async () => {},
    }),
    done: Promise.resolve(),
  };
  const storage = loadModule('src/db/storage.ts', {
    './idb': { getDB: async () => ({ transaction: () => fakeTx, get: async () => ({ id: 'p', sectionId: 's', title: 'Page', camera: { x: 0, y: 0, zoom: 1 } }) }) },
    '../services/sync/outbox': { queueLocalChange: async () => { queued.push('queued'); }, getSyncBinding: () => ({ provider: 'turso', userId: 'u' }) },
    '../services/sync/outboxContext': { getSyncBinding: () => ({ provider: 'turso', userId: 'u' }) },
    '../services/sync/syncEngine': { syncEngine: { notifyChange: () => { notified++; } } },
  });

  await storage.savePageDiff('p', { metadata: { camera: { x: 100, y: 200, zoom: 1.5 } } });
  assert.equal(queued.length, 0);
  assert.equal(notified, 0);

  // Content edits (strokes) must queue and notify
  await storage.savePageDiff('p', { strokes: { put: [{ id: 's1', pageId: 'p' }] } });
  assert.equal(queued.length, 1);
  assert.equal(notified, 1);
});

test('deleted page on both local and cloud does not produce conflict even with leftover elements', async () => {
  const safePull = loadModule('src/services/sync/safePull.ts');
  const cloud = {
    notebooks: [{ id: 'n1', title: 'Notebook', createdAt: 1, updatedAt: 1, order: 0 }],
    sections: [{ id: 's1', notebookId: 'n1', title: 'Section', color: 'blue', order: 0, updatedAt: 1 }],
    pages: [{ id: 'deleted_page', title: 'Deleted Page', sectionId: 's1', createdAt: 1, updatedAt: 2, deletedAt: 2, order: 0, camera: { x: 0, y: 0, zoom: 1 }, background: 'plain' }],
    elements: Array.from({ length: 408 }, (_, i) => ({
      id: `el_${i}`,
      pageId: 'deleted_page',
      type: 'stroke',
      data: { id: `el_${i}`, pageId: 'deleted_page', points: [{ x: 0, y: 0 }], tool: 'pen', color: 'black', baseWidth: 2, opacity: 1, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, createdAt: 1 },
      updatedAt: 1,
    })),
  };
  const localTables = {
    notebooks: [{ id: 'n1', title: 'Notebook', createdAt: 1, updatedAt: 1, order: 0 }],
    sections: [{ id: 's1', notebookId: 'n1', title: 'Section', color: 'blue', order: 0, updatedAt: 1 }],
    pages: [{ id: 'deleted_page', title: 'Deleted Page', sectionId: 's1', createdAt: 1, updatedAt: 2, deletedAt: 2, order: 0, camera: { x: 0, y: 0, zoom: 1 }, background: 'plain' }],
    strokes: Array.from({ length: 408 }, (_, i) => ({ id: `el_${i}`, pageId: 'deleted_page', points: [{ x: 0, y: 0 }], tool: 'pen', color: 'black', baseWidth: 2, opacity: 1, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, createdAt: 1 })),
    shapes: [],
    textBlocks: [],
    syncOutbox: [],
    assets: [],
  };
  const mockDb = {
    transaction: () => ({
      done: Promise.resolve(),
      objectStore: name => ({
        getAll: async () => localTables[name] || [],
        get: async id => (localTables[name] || []).find(r => r.id === id),
        put: async item => {
          const arr = localTables[name] || [];
          const idx = arr.findIndex(r => r.id === item.id);
          if (idx >= 0) arr[idx] = item; else arr.push(item);
        },
        delete: async id => {
          const arr = localTables[name] || [];
          const idx = arr.findIndex(r => r.id === id);
          if (idx >= 0) arr.splice(idx, 1);
        },
      }),
    }),
  };
  const res = await safePull.applyCloudPull(mockDb, cloud, new Set(), () => true);
  assert.equal(res.conflicts.size, 0, 'No conflict should be raised when page is deleted on both sides');
});

test('viewport changes preserve wire hashes but are not content differences', async () => {
  const { canonicalContentVersion, versionHash } = await import('../../src/services/sync/protocol.mjs');
  const { cloud } = conflictFixture();
  const page = cloud.pages[0];
  const moved = { ...page, camera: { x: 100, y: 200, zoom: 2 } };
  assert.notEqual(await versionHash('pages', page), await versionHash('pages', moved));
  assert.equal(canonicalContentVersion('pages', page), canonicalContentVersion('pages', moved));
  assert.notEqual(canonicalContentVersion('pages', page), canonicalContentVersion('pages', { ...moved, background: 'grid-small' }));
});

test('versioned pull clears stale viewport conflicts and accepts later cloud edits after scrolling', async () => {
  const { applyVersionedPull } = loadModule('src/services/sync/revisionPull.ts');
  const { db, tables, cloud, binding, state } = conflictFixture();
  tables.pages[0].camera = { x: 100, y: 200, zoom: 2 };
  const first = await applyVersionedPull(db, cloud, {}, binding, new Set(), () => true);
  assert.equal(first.conflicts.size, 0);
  assert.equal((await db.get('syncOutbox', state.key)).conflict, false);
  assert.equal(tables.pages[0].camera.zoom, 2);
  tables.pages[0].camera.x = 999;
  cloud.elements[0].data.color = 'red';
  cloud.pages[0].updatedAt++;
  const second = await applyVersionedPull(db, cloud, {}, binding, new Set(), () => true);
  assert.equal(second.conflicts.size, 0);
  assert.equal(tables.strokes[0].color, 'red');
  // Independent local and cloud edits still require a choice, even at equal counts.
  tables.strokes[0].color = 'blue';
  cloud.elements[0].data.color = 'green';
  const third = await applyVersionedPull(db, cloud, {}, binding, new Set(), () => true);
  assert.ok(third.conflicts.has('p'));
  assert.equal(tables.strokes[0].color, 'blue');
});

test('conflict listing removes equivalent versions but retains equal-count content conflicts', async () => {
  const { listConflicts } = loadModule('src/services/sync/conflicts.ts');
  const { db, tables, cloud, binding, state } = conflictFixture();
  tables.pages[0].camera.zoom = 2;
  const provider = { pullAll: async () => cloud };
  assert.deepEqual(await listConflicts(db, binding, provider), []);
  assert.equal((await db.get('syncOutbox', state.key)).conflict, false);
  tables.syncOutbox.find(row => row.key === state.key).conflict = true;
  tables.strokes[0].color = 'red';
  const rows = await listConflicts(db, binding, provider);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].localCount, rows[0].cloudCount);
  assert.equal((await db.get('syncOutbox', state.key)).conflict, true);
});

test('guarded sender acknowledges equivalent content despite a persisted conflict without writing cloud data', async () => {
  const { db, tables, cloud } = conflictFixture();
  const { syncEngine, queued } = engineFixture({}, {}, db);
  const entry = { key: 'pages:p', entity: 'pages', entityId: 'p', action: 'put', provider: 'turso', userId: 'user', operationId: '1' };
  queued.set(entry.key, entry);
  tables.pages[0].camera.zoom = 2;
  let writes = 0;
  const snapshot = { record: tables.pages[0], elements: { strokes: tables.strokes, shapes: [], textBlocks: [] } };
  const sent = await syncEngine.sendGuarded({ commit: async () => { writes++; } }, 'user', entry, snapshot, cloud, () => {});
  assert.equal(sent, true);
  assert.equal(queued.size, 0);
  assert.equal(writes, 0);
});

test('restored page queue ignores viewport and temporary image URLs but detects text and element type changes', () => {
  const { checkOutboxReplay } = loadModule('src/services/sync/replaySafety.ts');
  const { cloud, tables } = conflictFixture();
  tables.pages[0].camera.zoom = 2;
  const localText = { id: 'text', pageId: 'p', contentHTML: '<img data-asset-id="image" src="blob:local">' };
  const remoteText = { ...localText, contentHTML: '<img data-asset-id="image" src="blob:remote">' };
  const snapshot = { entry: { entity: 'pages', entityId: 'p', action: 'put' }, record: tables.pages[0], elements: { strokes: tables.strokes, shapes: [], textBlocks: [localText] } };
  cloud.elements.push({ id: 'text', pageId: 'p', type: 'textBlock', data: remoteText });
  assert.equal(checkOutboxReplay(snapshot, cloud), 'acknowledged');
  remoteText.contentHTML += 'Changed';
  assert.equal(checkOutboxReplay(snapshot, cloud), 'conflict');
  remoteText.contentHTML = localText.contentHTML;
  cloud.elements[0].type = 'shape';
  assert.equal(checkOutboxReplay(snapshot, cloud), 'conflict');
});

test('notebook conflicts do not create phantom page conflicts with the notebook ID', async () => {
  const { applyVersionedPull } = loadModule('src/services/sync/revisionPull.ts');
  const { db, tables, cloud, binding } = conflictFixture();
  tables.notebooks[0].title = 'Local notebook';
  cloud.notebooks[0].title = 'Cloud notebook';
  const result = await applyVersionedPull(db, cloud, {}, binding, new Set(), () => true);
  assert.ok(result.conflicts.has('n'));
  const flags = tables.syncOutbox.filter(row => row.conflict);
  assert.deepEqual(flags.map(row => [row.entity, row.entityId]), [['notebooks', 'n']]);
});

test('successful background upload preserves error status while other notes have conflicts', async () => {
  const { db } = conflictFixture();
  const { syncEngine, useSyncStore } = engineFixture({}, {}, db);
  syncEngine.notifyChange({ notebooks: [{ id: 'new', title: 'New notebook' }] });
  useSyncStore.setState({ userId: 'user', lastSyncedAt: 123 });
  assert.equal(await syncEngine.flushPendingChanges(), true);
  assert.equal(useSyncStore.getState().status, 'error');
  assert.match(useSyncStore.getState().errorMessage, /Различаются версии/);
  assert.equal(useSyncStore.getState().lastSyncedAt, 123);
});

test('choosing a conflict version reports a failed send instead of declaring sync success', async () => {
  const { db } = conflictFixture();
  const { syncEngine, useSyncStore } = engineFixture({ guarded: true }, {}, db, {
    './conflicts': { resolveConflict: async () => {}, listConflicts: async () => [] },
  });
  syncEngine.notifyChange({ notebooks: [{ id: 'n', title: 'Chosen version' }] });
  useSyncStore.setState({ userId: 'user' });
  syncEngine.sendGuarded = async () => { useSyncStore.getState().setError('Chosen version upload failed'); return false; };
  await assert.rejects(syncEngine.chooseConflict('notebooks', 'n', 'local'), /Chosen version upload failed/);
  assert.equal(useSyncStore.getState().status, 'error');
  assert.equal(useSyncStore.getState().errorMessage, 'Chosen version upload failed');
});

test('cloud drawings without page metadata are not treated as a matching deletion', async () => {
  const { listConflicts } = loadModule('src/services/sync/conflicts.ts');
  const { db, tables, cloud, binding, state } = conflictFixture();
  tables.pages[0].deletedAt = 10;
  cloud.pages = [];
  const rows = await listConflicts(db, binding, { pullAll: async () => cloud });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cloudTitle, 'Содержимое без метаданных страницы');
  assert.equal((await db.get('syncOutbox', state.key)).conflict, true);
  assert.equal(tables.strokes.length, 1);
});

function notebookEditingFixture() {
  const notebook = { id: 'n', title: 'Notebook' }, section = { id: 's', notebookId: 'n', title: 'Section' };
  const page = { id: 'p', sectionId: 's', title: 'Current', order: 0, createdAt: 1, camera: { x: 0, y: 0, zoom: 1 }, background: 'plain' };
  const pages = [page, { ...page, id: 'other' }], loaded = [];
  const canvas = { currentPageId: 'p', getEditRevision: () => 0, flushAllSaves: async () => {}, loadPage: async id => { loaded.push(id); canvas.currentPageId = id; } };
  const storage = { loadNotebooks: async () => [notebook], loadSections: async () => [section], loadPages: async () => pages, loadAllPages: async () => pages, createPage: async page => { pages.push(page); } };
  const { useNotebookStore } = loadModule('src/store/useNotebookStore.ts', { '../db/storage': storage, './useCanvasStore': { useCanvasStore: { getState: () => canvas } } });
  useNotebookStore.setState({ notebooks: [notebook], activeNotebook: notebook, sections: [section], activeSection: section, pages: [...pages], activePage: page });
  return { store: useNotebookStore, canvas, storage, pages, loaded };
}

test('background sync of another page does not reload the open canvas or reset its viewport', async () => {
  const { store, loaded } = notebookEditingFixture();
  await store.getState().refreshFromStorage(new Set(['other']));
  assert.deepEqual(loaded, []);
  assert.equal(store.getState().activePage.id, 'p');
  await store.getState().refreshFromStorage(new Set(['p']));
  assert.deepEqual(loaded, ['p']);
});

test('a delayed background refresh cannot navigate back after the user changes pages', async () => {
  const { store, canvas, storage, pages, loaded } = notebookEditingFixture(), gate = deferred();
  storage.loadNotebooks = () => gate.promise;
  const refresh = store.getState().refreshFromStorage(new Set(['p']));
  canvas.currentPageId = 'other';
  store.setState({ activePage: pages[1] });
  gate.resolve([{ id: 'n', title: 'Notebook' }]);
  await refresh;
  assert.equal(store.getState().activePage.id, 'other');
  assert.deepEqual(loaded, []);
});

test('new page becomes active only after its canvas loads successfully', async () => {
  const { store, canvas } = notebookEditingFixture(), gate = deferred();
  canvas.loadPage = async id => { await gate.promise; canvas.currentPageId = id; };
  const creating = store.getState().addPage('New');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getState().activePage.id, 'p');
  assert.equal(canvas.currentPageId, 'p');
  gate.resolve();
  const page = await creating;
  assert.equal(store.getState().activePage.id, page.id);
  assert.equal(canvas.currentPageId, page.id);
});

test('blocked page creation preserves the previous active page and canvas', async () => {
  const { store, canvas } = notebookEditingFixture();
  canvas.loadPage = async () => { throw Error('Still drawing'); };
  await assert.rejects(store.getState().addPage('New'), /Still drawing/);
  assert.equal(store.getState().activePage.id, 'p');
  assert.equal(canvas.currentPageId, 'p');
});

