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
} finally {
  await browser?.close();
  await server.close();
}
