// Runs a NEW isolated headless browser context, never the user's browser profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { canonical } from './backup-core.mjs';

const output = process.env.STAGE0_TEST_OUTPUT;
if (!output || !process.env.STAGE0_PLAYWRIGHT_MODULE) throw new Error('Set STAGE0_TEST_OUTPUT and STAGE0_PLAYWRIGHT_MODULE; use a new output directory');
await mkdir(output);
const { chromium } = createRequire(import.meta.url)(process.env.STAGE0_PLAYWRIGHT_MODULE);
const server = createServer(async (request, response) => {
  const name = request.url?.split('?')[0];
  if (name === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><title>Stage 0 isolated test</title><h1>Restored test notes</h1><div id="preview"></div>'); return; }
  if (['/backup-core.mjs', '/indexeddb-backup.mjs'].includes(name)) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(new URL(`.${name}`, import.meta.url)));
  } else { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 950, height: 720 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const api = await import('/indexeddb-backup.mjs');
    const core = await import('/backup-core.mjs');
    const pngCanvas = document.createElement('canvas'); pngCanvas.width = 48; pngCanvas.height = 48;
    const pctx = pngCanvas.getContext('2d'); pctx.fillStyle = '#4f46e5'; pctx.fillRect(0, 0, 48, 48);
    const blob = await new Promise(resolve => pngCanvas.toBlob(resolve, 'image/png'));
    const fixture = {
      notebooks: [{ id: 'nb-college', title: 'Legacy notebook retained', order: 0 }, { id: 'nb-real', title: 'Real notebook retained', order: 1 }],
      sections: [{ id: 'sec', notebookId: 'nb-real', title: 'Test section', order: 0 }],
      pages: [{ id: 'p', sectionId: 'sec', title: 'Text, drawing and image', slug: 'original', slugAliases: ['old-link'], order: 0 }, { id: 'trash', sectionId: 'sec', title: 'Restorable deleted page', deletedAt: 1234, order: 1 }],
      strokes: [{ id: 'stroke', pageId: 'p', points: [{ x: 20, y: 45 }, { x: 90, y: 10 }, { x: 160, y: 65 }], color: '#107c41' }],
      shapes: [{ id: 'shape', pageId: 'p', type: 'rectangle', anchor: { x: 10, y: 10 }, end: { x: 40, y: 40 } }],
      textBlocks: [{ id: 'text', pageId: 'p', contentHTML: '<p>Текст и формула 2<sup>2</sup></p><table><tr><td>A</td><td>B</td></tr></table><img data-asset-id="asset" src="blob:obsolete">' }],
      assets: [{ id: 'asset', pageId: 'p', blob, mimeType: 'image/png', name: 'test.png' }],
      extra: [{ id: 'future', absent: undefined, date: new Date('2020-01-01T00:00:00Z'), bytes: new Uint16Array([12, 65535]), negativeZero: -0, value: NaN }],
    };
    const req = indexedDB.open('onenote_clone_db', 2);
    req.onupgradeneeded = () => {
      for (const name of Object.keys(fixture)) {
        const store = req.result.createObjectStore(name, { keyPath: 'id' });
        if (['strokes', 'shapes', 'textBlocks', 'assets'].includes(name)) store.createIndex('by-page', 'pageId');
      }
    };
    const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const tx = db.transaction(Object.keys(fixture), 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    for (const [name, records] of Object.entries(fixture)) for (const record of records) tx.objectStore(name).add(record);
    await done; db.close();
    const original = await api.captureIndexedDB();
    const restored = await api.restoreTemporary(JSON.parse(JSON.stringify(original.snapshot)), 'notes_stage0_restore_roundtrip');
    const after = await api.captureIndexedDB();
    const beforeMissing = await indexedDB.databases();
    let missingRejected = false;
    try { await api.captureIndexedDB('absent_database'); } catch { missingRejected = true; }
    const missingDidNotCreate = !(await indexedDB.databases()).some(db => db.name === 'absent_database');
    let productionRestoreRejected = false, overwriteRejected = false, corruptionRejected = false;
    try { await api.restoreTemporary(original.snapshot, 'onenote_clone_db'); } catch { productionRestoreRejected = true; }
    try { await api.restoreTemporary(original.snapshot, restored.name); } catch { overwriteRejected = true; }
    const corrupt = JSON.parse(JSON.stringify(original.snapshot)); corrupt.stores[0].records[0].value = ['null'];
    try { await api.restoreTemporary(corrupt, 'notes_stage0_restore_corrupt'); } catch { corruptionRejected = true; }
    const corruptedDidNotCreate = !(await indexedDB.databases()).some(db => db.name === 'notes_stage0_restore_corrupt');
    const recovered = await api.captureIndexedDB(restored.name);
    const data = Object.fromEntries(recovered.snapshot.stores.map(s => [s.name, s.records.map(r => core.decode(r.value))]));
    // Safe preview: textContent, generated canvas, recovered binary image; no user HTML execution.
    const preview = document.querySelector('#preview');
    const text = document.createElement('pre'); text.textContent = data.textBlocks[0].contentHTML; preview.append(text);
    const caption = document.createElement('p'); caption.textContent = `Notebooks: ${data.notebooks.map(n => n.title).join(', ')}. Trash: ${data.pages.find(p => p.deletedAt).title}. Aliases: ${data.pages[0].slugAliases.join(', ')}`; preview.append(caption);
    const canvas = document.createElement('canvas'); canvas.width = 220; canvas.height = 100;
    const ctx = canvas.getContext('2d'); ctx.strokeStyle = data.strokes[0].color; ctx.lineWidth = 4; ctx.beginPath();
    data.strokes[0].points.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
    ctx.strokeRect(data.shapes[0].anchor.x, data.shapes[0].anchor.y, 30, 30); preview.append(canvas);
    const image = document.createElement('img'); image.src = URL.createObjectURL(data.assets[0].blob); preview.append(image); await image.decode();
    return { snapshot: original.snapshot, sourceBefore: original.snapshot.manifest, sourceAfter: after.snapshot.manifest, restored, missingRejected, missingDidNotCreate, productionRestoreRejected, overwriteRejected, corruptionRejected, corruptedDidNotCreate,
      binaryImageOpened: image.naturalWidth === 48 && image.naturalHeight === 48,
      typesPreserved: data.extra[0].date instanceof Date && data.extra[0].bytes instanceof Uint16Array && Object.hasOwn(data.extra[0], 'absent') && Object.is(data.extra[0].negativeZero, -0) && Number.isNaN(data.extra[0].value),
      relationIssues: recovered.relationIssues, existingNames: beforeMissing.map(db => db.name) };
  });
  assert.equal(canonical(result.sourceBefore), canonical(result.sourceAfter));
  assert.equal(result.restored.verified, true);
  for (const key of ['missingRejected', 'missingDidNotCreate', 'productionRestoreRejected', 'overwriteRejected', 'corruptionRejected', 'corruptedDidNotCreate', 'binaryImageOpened', 'typesPreserved']) assert.equal(result[key], true, key);
  assert.deepEqual(result.relationIssues, []);
  await writeFile(resolve(output, 'indexeddb-fixture-snapshot.json'), JSON.stringify(result.snapshot), { flag: 'wx' });
  delete result.snapshot;
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ fixtureOnly: true, ...result }, null, 2), { flag: 'wx' });
  await page.screenshot({ path: resolve(output, 'restored-preview.png') });
  console.log(JSON.stringify({ passed: true, checks: 11, fixtureOnly: true, output }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
