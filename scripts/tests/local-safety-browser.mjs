// Fresh Chromium context and local fixture only; never opens the deployed app.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

if (!process.env.NOTES_PLAYWRIGHT_MODULE) throw new Error('Set NOTES_PLAYWRIGHT_MODULE to an installed Playwright module');
const { chromium } = createRequire(import.meta.url)(process.env.NOTES_PLAYWRIGHT_MODULE);
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'local-safety-fixture',
  configureServer(vite) {
    vite.middlewares.use('/__local-safety', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(await vite.transformIndexHtml('/__local-safety', `<!doctype html><meta charset="utf-8"><title>Local save fixture</title><div id="root"></div>
        <script type="module">
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { LocalSaveStatus } from '/src/components/common/LocalSaveStatus.tsx';
        import { useCanvasStore } from '/src/store/useCanvasStore.ts';
        window.fixtureFailure = true;
        window.fixtureWrites = [];
        window.fixtureStore = useCanvasStore;
        useCanvasStore.setState({ currentPageId: 'fixture-page' });
        createRoot(document.getElementById('root')).render(React.createElement(LocalSaveStatus));
        </script>`));
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await context.route('**/src/services/sync/tursoProvider.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export class TursoProvider {}' }));
  await context.route('**/src/services/sync/supabaseProvider.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export class SupabaseProvider { setTokenProvider() {} }' }));
  await context.route('**/src/store/useNotebookStore.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const useNotebookStore = { getState: () => ({ refreshFromStorage: async () => {} }) };' }));
  const page = await context.newPage();
  const unexpected = [];
  page.on('pageerror', error => unexpected.push(error.message));
  await page.route('**/src/db/storage.ts*', route => route.request().url().includes('outbox-test') ? route.continue() : route.fulfill({ contentType: 'application/javascript', body: `
    export async function savePageDiff(id, diff) {
      if (window.fixtureFailure) throw new Error('Simulated IndexedDB quota failure');
      window.fixtureWrites.push({ id, diff });
    }
    export const savePageFull = savePageDiff;
    export async function loadPageData() { return { strokes: [], shapes: [], textBlocks: [] }; }
  ` }));
  await page.goto(`${server.resolvedUrls.local[0]}__local-safety`);
  await page.getByRole('button', { name: 'Сохранено на устройстве', exact: true }).waitFor();
  await page.evaluate(() => window.fixtureStore.getState().setCamera({ x: 7, y: 8, zoom: 2 }));
  await page.getByRole('button', { name: 'Есть правки', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).waitFor();
  assert.match(await page.getByRole('button').getAttribute('title'), /остаются в памяти/);
  await page.evaluate(() => { window.fixtureFailure = false; });
  await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранено на устройстве', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureWrites[0].diff.metadata.camera.zoom), 2);
  assert.deepEqual(unexpected, []);
  console.log('Isolated browser: saved → edits → error → retry → saved passed; original diff retained.');

  const results = await page.evaluate(async () => {
    const { getDB } = await import('/src/db/idb.ts');
    const { applyCloudPull } = await import('/src/services/sync/safePull.ts');
    const { decodeCloudElements } = await import('/src/services/sync/cloudElements.ts');
    const { compressBatch, decompressBatch } = await import('/src/services/sync/compression.ts');
    const stores = ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'];
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const reject = async (work, message) => { try { await work(); } catch { return; } throw Error(message); };
    const notebook = { id: 'n', title: 'Keep notebook', createdAt: 1, updatedAt: 10, order: 0 };
    const section = { id: 'sec', notebookId: 'n', title: 'Keep section', color: 'red', order: 0, updatedAt: 10 };
    const originalPage = { id: 'p', sectionId: 'sec', title: 'Keep page', createdAt: 1, updatedAt: 10, order: 0, camera: { x: 0, y: 0, zoom: 1 }, background: 'plain', slug: 'keep', slugAliases: ['old-link'] };
    const stroke = { id: 's', pageId: 'p', points: [{ x: 1, y: 2 }], color: 'black', baseWidth: 3, opacity: 1, tool: 'pen', bounds: { minX: 1, minY: 2, maxX: 1, maxY: 2 }, createdAt: 1 };
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open('onenote_clone_db', 2);
      request.onupgradeneeded = () => {
        const indexes = { notebooks: { 'by-order': 'order' }, sections: { 'by-notebook': 'notebookId', 'by-order': 'order' }, pages: { 'by-section': 'sectionId', 'by-order': 'order' }, strokes: { 'by-page': 'pageId' }, shapes: { 'by-page': 'pageId' }, textBlocks: { 'by-page': 'pageId' }, assets: { 'by-page': 'pageId' } };
        for (const [name, entries] of Object.entries(indexes)) {
          const store = request.result.createObjectStore(name, { keyPath: 'id' });
          for (const [index, key] of Object.entries(entries)) store.createIndex(index, key);
        }
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const seed = legacy.transaction([...stores, 'assets'], 'readwrite');
    seed.objectStore('notebooks').put(notebook); seed.objectStore('sections').put(section); seed.objectStore('pages').put(originalPage); seed.objectStore('strokes').put(stroke);
    seed.objectStore('pages').put({ ...originalPage, id: 'trash-page', deletedAt: 2 });
    seed.objectStore('assets').put({ id: 'original-image', pageId: 'p', blob: new Blob(['original image bytes']), mimeType: 'image/png', createdAt: 1 });
    await new Promise((resolve, reject) => { seed.oncomplete = resolve; seed.onabort = () => reject(seed.error); });
    let blocked = false;
    try { await getDB(); } catch (error) { blocked = error.message.includes('Закройте другие вкладки'); }
    check(blocked, 'Blocked schema upgrade did not offer recovery');
    legacy.close();
    const db = await getDB();
    check(db.version === 3 && db.objectStoreNames.contains('syncOutbox'), 'Additive upgrade failed');
    check((await db.get('pages', 'trash-page')).deletedAt === 2, 'Upgrade lost trash');
    check(await (await db.get('assets', 'original-image')).blob.text() === 'original image bytes', 'Upgrade changed binary asset');
    const snapshot = async () => JSON.stringify(await Promise.all(stores.map(name => db.getAll(name))));
    const initial = await snapshot();
    const empty = () => ({ notebooks: [], sections: [], pages: [], elements: [] });
    await applyCloudPull(db, empty(), new Set()); check(await snapshot() === initial, 'Empty cloud changed local notes');
    await reject(() => applyCloudPull(db, { notebooks: [] }, new Set()), 'Incomplete cloud was accepted');
    check(await snapshot() === initial, 'Incomplete cloud changed local notes');
    const remote = { ...stroke, color: 'red' };
    const conflict = await applyCloudPull(db, { ...empty(), pages: [{ ...originalPage, title: 'Remote title', updatedAt: 20 }], elements: [{ id: 's', pageId: 'p', type: 'stroke', data: remote, updatedAt: 20 }] }, new Set());
    check(conflict.conflicts.has('p') && await snapshot() === initial, 'Remote conflict overwrote or overlaid local content');
    const tombstone = { notebooks: [{ ...notebook, updatedAt: 30, deletedAt: 30 }], sections: [{ ...section, updatedAt: 30, deletedAt: 30 }], pages: [{ ...originalPage, updatedAt: 30, deletedAt: 30 }], elements: [{ id: 's', pageId: 'p', type: 'stroke', data: null, updatedAt: 30, deletedAt: 30 }] };
    await applyCloudPull(db, tombstone, new Set()); check(await snapshot() === initial, 'Cloud tombstones hid populated local notes');
    const newPage = { ...originalPage, id: 'p2', slug: 'new', slugAliases: [], updatedAt: 20 };
    const newStroke = { ...stroke, id: 's2', pageId: 'p2' };
    const valid = { ...empty(), pages: [newPage], elements: [{ id: 's2', pageId: 'p2', type: 'stroke', data: newStroke, updatedAt: 20 }] };
    const originalTransaction = db.transaction.bind(db);
    const failingDB = { transaction(names, mode) {
      const tx = originalTransaction(names, mode); let writes = 0;
      return { done: tx.done, abort: () => tx.abort(), objectStore(name) {
        const store = tx.objectStore(name);
        return { getAll: () => store.getAll(), put(value) { if (++writes === 2) throw Error('Simulated second write failure'); return store.put(value); } };
      } };
    } };
    await reject(() => applyCloudPull(failingDB, valid, new Set()), 'Partial write should fail');
    check(await snapshot() === initial, 'Transaction failure left partial changes');
    let checks = 0;
    await reject(() => applyCloudPull(db, valid, new Set(), () => ++checks === 1), 'Changed edit revision should abort');
    check(await snapshot() === initial, 'Revision change did not rollback');
    await applyCloudPull(db, valid, new Set());
    check((await db.get('pages', 'p2')).title === newPage.title && (await db.get('strokes', 's2')).id === 's2', 'New cloud note not imported');
    check(JSON.stringify(await db.get('pages', 'p')) === JSON.stringify(originalPage), 'Existing slug/aliases not retained');
    await reject(() => decompressBatch('gz:broken!'), 'Corrupted compressed bundle accepted');
    await reject(() => decompressBatch({ strokes: [] }), 'Incomplete bundle accepted');
    const rawRows = [{ id: 'legacy', page_id: 'p', type: 'stroke', data: JSON.stringify({ ...stroke, id: 'legacy' }), updated_at: 5 },
      { id: 'bundle_p', page_id: 'p', type: 'bundle', data: await compressBatch({ strokes: [stroke], shapes: [], textBlocks: [] }), updated_at: 20 }];
    const decoded = await decodeCloudElements(rawRows);
    check(decoded.length === 1 && decoded[0].id === 's', 'Legacy row resurrected beside full bundle');
    rawRows[1].data = await compressBatch({ strokes: [], shapes: [], textBlocks: [] });
    check((await decodeCloudElements(rawRows)).length === 0, 'Empty authoritative bundle resurrected legacy row');
    return 'Real IndexedDB: empty/incomplete cloud, conflicts, tombstones, rollback, edits during pull, new-note import, aliases and bundle precedence passed.';
  });
  console.log(results);

  const durable = await page.evaluate(async () => {
    const storage = await import('/src/db/storage.ts?outbox-test');
    const { getDB } = await import('/src/db/idb.ts');
    const outbox = await import('/src/services/sync/outbox.ts');
    const { syncEngine, useSyncStore } = await import('/src/services/sync/syncEngine.ts');
    const db = await getDB();
    const check = (condition, message) => { if (!condition) throw Error(message); };
    localStorage.setItem('onenote_sync_owner', 'fixture-user');
    const binding = { userId: 'fixture-user', provider: 'turso' };
    await storage.savePageDiff('p', { metadata: { title: 'First durable edit' } });
    const first = (await outbox.pendingOutbox(binding))[0];
    check(first && !('strokes' in first) && !('textBlocks' in first), 'Queue duplicated content');
    await storage.savePageDiff('p', { metadata: { title: 'Newer durable edit' } });
    const newer = (await outbox.pendingOutbox(binding))[0];
    await outbox.acknowledgeOutbox(first);
    check((await outbox.pendingOutbox(binding))[0].operationId === newer.operationId, 'Old acknowledgement removed newer work');
    check(await outbox.readOutboxSnapshot(first) === null, 'Old operation obtained a new payload');
    check((await outbox.readOutboxSnapshot(newer)).page.title === 'Newer durable edit', 'Snapshot did not retain latest metadata');
    check((await outbox.pendingOutbox({ ...binding, userId: 'another-user' })).length === 0, 'Queue crossed account boundary');
    check((await outbox.pendingOutbox({ ...binding, provider: 'supabase' })).length === 0, 'Queue crossed provider boundary');
    const before = JSON.stringify(await db.get('pages', 'p'));
    const tx = db.transaction(['pages', 'syncOutbox'], 'readwrite');
    await tx.objectStore('pages').put({ ...JSON.parse(before), title: 'Must roll back' });
    const failing = { done: tx.done, abort: () => tx.abort(), objectStore() { return { put() { throw Error('Simulated queue write failure'); } }; } };
    let rejected = false; try { await outbox.queueLocalChange(failing, 'pages', 'p', 'put', binding); } catch { rejected = true; }
    await tx.done.catch(() => {});
    check(rejected && JSON.stringify(await db.get('pages', 'p')) === before, 'Queue failure committed local-only half of transaction');
    const realTx = db.transaction('syncOutbox', 'readwrite');
    await outbox.queueLocalChange(realTx, 'pages', 'p', 'put', { ...binding, userId: null }); await realTx.done;
    await outbox.claimUnownedOutbox(binding);
    check((await outbox.pendingOutbox({ ...binding, userId: null })).length === 0, 'Explicit claim left anonymous entry');
    await outbox.acknowledgeOutbox(newer);
    check((await outbox.pendingOutbox(binding)).length === 1, 'Old acknowledgement removed claimed work');
    await storage.moveToTrashPage('p'); check((await outbox.pendingOutbox(binding))[0].action === 'delete', 'Trash did not persist delete intent');
    await storage.restorePage('p'); check((await outbox.pendingOutbox(binding))[0].action === 'put', 'Restore did not supersede delete');
    await storage.createNotebook({ id: 'new-n', title: 'New notebook', createdAt: 1, order: 20 });
    await storage.createSection({ id: 'new-sec', notebookId: 'new-n', title: 'New section', color: 'red', order: 0 });
    await storage.createPage({ ...(await db.get('pages', 'p')), id: 'new-p', sectionId: 'new-sec' });
    check((await outbox.pendingOutbox(binding)).length === 4, 'Structural creations were not tracked');
    await storage.renameNotebook('new-n', 'Renamed notebook'); await storage.updateSection('new-sec', { title: 'Renamed section' });
    check((await outbox.pendingOutbox(binding)).length === 4, 'Repeated structural edits grew the queue');
    await storage.deletePage('new-p');
    const deletion = (await outbox.pendingOutbox(binding)).find(entry => entry.entityId === 'new-p');
    check(deletion.action === 'delete' && !(await outbox.readOutboxSnapshot(deletion)).record, 'Permanent deletion lost its explicit intent');
    for (const entry of await outbox.pendingOutbox(binding)) if (entry.entityId !== 'p') await outbox.acknowledgeOutbox(entry);
    localStorage.setItem('onenote_sync_provider', 'local');
    const beforeLocal = (await outbox.pendingOutbox(binding))[0].operationId;
    await storage.savePageDiff('p', { metadata: { title: 'Local mode edit' } });
    check((await outbox.pendingOutbox(binding))[0].operationId === beforeLocal, 'Local mode queued a cloud upload');
    localStorage.setItem('onenote_sync_provider', 'turso');
    useSyncStore.setState({ userId: 'fixture-user', providerType: 'turso' });
    syncEngine.tursoProvider = { pushPages: async () => {}, pushPageElements: async () => { throw Error('Simulated network failure'); } };
    check(await syncEngine.flushPendingChanges() === false, 'Failed upload reported success');
    check((await outbox.pendingOutbox(binding)).length === 1, 'Failed upload erased durable queue');
    useSyncStore.setState({ userId: null });
    await syncEngine.flushPendingChanges(); // Clear test retry timer without a network call.
    return 'Durable queue: atomic save+intent, bounded markers, conditional ack, stale snapshot, account/provider scope, explicit claim, trash/restore and failed send passed.';
  });
  console.log(durable);
  await page.reload();
  await page.getByRole('button', { name: 'Сохранено на устройстве', exact: true }).waitFor();
  const reloaded = await page.evaluate(async () => {
    const { pendingOutbox } = await import('/src/services/sync/outbox.ts');
    const { getDB } = await import('/src/db/idb.ts');
    return { entries: (await pendingOutbox({ provider: 'turso', userId: 'fixture-user' })).length, title: (await (await getDB()).get('pages', 'p')).title };
  });
  assert.equal(reloaded.entries, 1); assert.equal(reloaded.title, 'Local mode edit');
  console.log('Reload retained both the local note and its queued operation.');

  if (process.env.NOTES_ROLLBACK_READER) {
    const source = await readFile(process.env.NOTES_ROLLBACK_READER, 'utf8');
    const result = await page.evaluate(async source => {
      const code = source.replace(/from ['"]idb['"]/, `from '${location.origin}/node_modules/.vite/deps/idb.js'`);
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try {
        const reader = await import(url);
        const db = await reader.getDB();
        const result = { version: db.version, title: (await db.get('pages', 'p')).title, pending: (await db.getAll('syncOutbox')).length, assets: await db.count('assets') };
        db.close();
        return result;
      } finally { URL.revokeObjectURL(url); }
    }, source);
    assert.equal(result.version, 3); assert.equal(result.title, 'Local mode edit');
    assert.ok(result.pending >= 1); assert.ok(result.assets >= 1);
    console.log('Rollback compatibility reader opened schema 3 and preserved notes, assets and queued operations.');
  }

  const secondPage = await context.newPage();
  await secondPage.goto(`${server.resolvedUrls.local[0]}__local-safety`);
  await secondPage.getByRole('button', { name: 'Сохранено на устройстве', exact: true }).waitFor();
  const firstSend = page.evaluate(async () => {
    const { syncEngine, useSyncStore } = await import('/src/services/sync/syncEngine.ts');
    localStorage.setItem('fixtureActiveUploads', '0'); localStorage.setItem('fixtureMaxUploads', '0');
    localStorage.setItem('fixtureSecondMetadata', '0');
    const gate = new Promise(resolve => { window.releaseUpload = resolve; });
    syncEngine.tursoProvider = { pullAll: async () => ({ notebooks: [], sections: [], pages: [], elements: [] }), pushPages: async () => {}, pushPageElements: async () => {
      const active = Number(localStorage.getItem('fixtureActiveUploads')) + 1;
      localStorage.setItem('fixtureActiveUploads', String(active)); localStorage.setItem('fixtureMaxUploads', String(active));
      window.firstUploadStarted = true; await gate;
      localStorage.setItem('fixtureActiveUploads', String(active - 1));
    } };
    useSyncStore.setState({ userId: 'fixture-user', providerType: 'turso' });
    return await syncEngine.flushPendingChanges();
  });
  await page.waitForFunction(() => window.firstUploadStarted === true);
  const secondSend = secondPage.evaluate(async () => {
    const { syncEngine, useSyncStore } = await import('/src/services/sync/syncEngine.ts');
    const storage = await import('/src/db/storage.ts');
    await storage.savePageDiff('p', { metadata: { title: 'Second tab edit' } });
    syncEngine.tursoProvider = { pushPages: async () => { localStorage.setItem('fixtureSecondMetadata', '1'); }, pushPageElements: async () => {
      const active = Number(localStorage.getItem('fixtureActiveUploads')) + 1;
      localStorage.setItem('fixtureMaxUploads', String(Math.max(Number(localStorage.getItem('fixtureMaxUploads')), active)));
    } };
    useSyncStore.setState({ userId: 'fixture-user', providerType: 'turso' });
    window.secondSenderReady = true;
    return await syncEngine.flushPendingChanges();
  });
  await secondPage.waitForFunction(() => window.secondSenderReady === true);
  assert.equal(await page.evaluate(() => localStorage.getItem('fixtureSecondMetadata')), '0', 'Second tab started before first upload released its lock');
  await page.evaluate(() => window.releaseUpload());
  assert.deepEqual(await Promise.all([firstSend, secondSend]), [true, true]);
  const drained = await page.evaluate(async () => {
    const { pendingOutbox } = await import('/src/services/sync/outbox.ts');
    const { getDB } = await import('/src/db/idb.ts');
    return { pending: (await pendingOutbox({ provider: 'turso', userId: 'fixture-user' })).length, max: Number(localStorage.getItem('fixtureMaxUploads')), title: (await (await getDB()).get('pages', 'p')).title };
  });
  assert.equal(drained.pending, 0); assert.equal(drained.max, 1); assert.equal(drained.title, 'Second tab edit');
  console.log('Two tabs serialized uploads, preserved an edit during the first send, and drained only the acknowledged operation.');
} finally {
  await browser?.close();
  await server.close();
}
