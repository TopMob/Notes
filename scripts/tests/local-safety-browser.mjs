// Fresh Chromium context and local fixture only; never opens the deployed app.
import assert from 'node:assert/strict';
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
  const page = await context.newPage();
  const unexpected = [];
  page.on('pageerror', error => unexpected.push(error.message));
  await page.route('**/src/db/storage.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
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
    const db = await getDB();
    const stores = ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'];
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const reject = async (work, message) => { try { await work(); } catch { return; } throw Error(message); };
    const notebook = { id: 'n', title: 'Keep notebook', createdAt: 1, updatedAt: 10, order: 0 };
    const section = { id: 'sec', notebookId: 'n', title: 'Keep section', color: 'red', order: 0, updatedAt: 10 };
    const originalPage = { id: 'p', sectionId: 'sec', title: 'Keep page', createdAt: 1, updatedAt: 10, order: 0, camera: { x: 0, y: 0, zoom: 1 }, background: 'plain', slug: 'keep', slugAliases: ['old-link'] };
    const stroke = { id: 's', pageId: 'p', points: [{ x: 1, y: 2 }], color: 'black', baseWidth: 3, opacity: 1, tool: 'pen', bounds: { minX: 1, minY: 2, maxX: 1, maxY: 2 }, createdAt: 1 };
    await db.put('notebooks', notebook); await db.put('sections', section); await db.put('pages', originalPage); await db.put('strokes', stroke);
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
    db.close();
    return 'Real IndexedDB: empty/incomplete cloud, conflicts, tombstones, rollback, edits during pull, new-note import, aliases and bundle precedence passed.';
  });
  console.log(results);
} finally {
  await browser?.close();
  await server.close();
}
