// Fresh browser profile and synthetic notes only. All remote requests are blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const { chromium } = createRequire(import.meta.url)(process.env.NOTES_PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({ server:{host:'127.0.0.1',port:0}, plugins:[{
  name:'canvas-fixture', configureServer(vite) {
    vite.middlewares.use('/__canvas-test', async (_req,res) => {
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(await vite.transformIndexHtml('/__canvas-test', `<!doctype html><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%}</style><div id="root"></div><script type="module">
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import '/src/styles/tokens.css'; import '/src/styles/reset.css'; import '/src/styles/app.css';
      import {InfiniteCanvas} from '/src/components/canvas/InfiniteCanvas.tsx';
      import {useCanvasStore} from '/src/store/useCanvasStore.ts';
      import {globalCommandStack} from '/src/canvas/history/CommandStack.ts';
      window.store=useCanvasStore; window.stack=globalCommandStack; window.writes=[];
      useCanvasStore.setState({currentPageId:'p',activeTool:'cursor',background:'plain',textBlocks:[{id:'tb',pageId:'p',x:100,y:80,width:400,zIndex:10,contentHTML:'<p>Keep this note</p>'}]});
      function Fixture(){const id=useCanvasStore(s=>s.currentPageId);return React.createElement(InfiniteCanvas,{key:id});}
      createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Fixture)));
      </script>`));
    });
  }
}]});
let browser;
try {
  await server.listen(); browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1200,height:800}});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/src/db/storage.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    export async function savePageDiff(id,diff){window.writes.push({id,diff:structuredClone(diff)});}
    export const savePageFull=savePageDiff;
    export async function loadPageData(){return {strokes:[],shapes:[],textBlocks:[]};}
  `}));
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'__canvas-test');
  const block=page.locator('.text-block-container'); const content=page.locator('.text-block-content');
  await content.waitFor();
  let rect=await block.boundingBox(); assert.equal(rect.x,700); assert.equal(rect.y,480);
  await content.click(); await page.keyboard.press('End'); await page.keyboard.type(' typed');
  await page.evaluate(()=>{window.originalContent=document.querySelector('.text-block-content');window.store.getState().setCamera({x:50,y:20,zoom:1.5});});
  await page.waitForFunction(()=>document.querySelector('.dom-text-overlay > div').style.transform.includes('1.5'));
  rect=await block.boundingBox(); assert.equal(rect.x,675); assert.equal(rect.y,490);
  assert.ok(await page.evaluate(()=>document.activeElement===window.originalContent && document.querySelector('.text-block-content')===window.originalContent));
  assert.match(await content.textContent(),/Keep this note typed/);
  await page.keyboard.type(' more'); await content.blur();
  assert.match(await page.evaluate(()=>window.store.getState().textBlocks[0].contentHTML),/typed more/);
  // Drawing and its history use real pointer handlers and real persistence diffs.
  await page.evaluate(()=>window.store.getState().setActiveTool('pen'));
  await page.mouse.move(100,120); await page.mouse.down(); await page.mouse.move(300,220,{steps:30}); await page.mouse.up();
  await page.waitForFunction(()=>window.store.getState().strokes.length===1);
  const points=await page.evaluate(()=>window.store.getState().strokes[0].points.length); assert.ok(points>=30);
  await page.evaluate(async()=>{await window.store.getState().flushAllSaves();window.stack.undo();});
  assert.equal(await page.evaluate(()=>window.store.getState().strokes.length),0);
  await page.evaluate(()=>window.stack.redo());
  assert.equal(await page.evaluate(()=>window.store.getState().strokes[0].points.length),points);
  // Leaving during a held stroke commits it on the original page before loading.
  await page.mouse.move(100,300); await page.mouse.down(); await page.mouse.move(300,350,{steps:12});
  await page.evaluate(()=>window.store.getState().loadPage('other'));
  await page.mouse.up();
  assert.ok(await page.evaluate(()=>window.writes.some(w=>w.id==='p' && w.diff.strokes?.put?.some(s=>s.points.length>=12))));
  assert.equal(await page.evaluate(()=>window.store.getState().currentPageId),'other');
  assert.deepEqual(errors,[]);
  console.log('Canvas browser: transformed text/focus/caret, full pen input, undo/redo and page leave passed.');
} finally { await browser?.close(); await server.close(); }
