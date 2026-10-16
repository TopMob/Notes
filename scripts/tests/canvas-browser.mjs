// Fresh browser profile and synthetic notes only. All remote requests are blocked.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
      import {ExportModal} from '/src/components/modals/ExportModal.tsx';
      import {useUiStore} from '/src/store/useUiStore.ts'; window.ui=useUiStore;
      import {assetManager} from '/src/services/assets/assetManager.ts'; window.assets=assetManager;
      window.store=useCanvasStore; window.stack=globalCommandStack; window.writes=[];
      useCanvasStore.setState({currentPageId:'p',activeTool:'cursor',background:'plain',textBlocks:[{id:'tb',pageId:'p',x:100,y:80,width:400,zIndex:10,contentHTML:'<p>Keep this note</p>'}]});
      function Fixture(){const id=useCanvasStore(s=>s.currentPageId);return React.createElement(React.Fragment,null,React.createElement(InfiniteCanvas,{key:id}),React.createElement(ExportModal));}
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
  await context.route('**/src/store/useNotebookStore.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const useNotebookStore=()=>({activePage:{title:'Fixture'}});`}));
  const page=await context.newPage(); const errors=[];
  page.setDefaultTimeout(15000);
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
  await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;
    const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,4,4);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve));window.assets.registerAsset('export-image',blob);
    window.store.setState({strokes:[],textBlocks:[{id:'export',pageId:'other',x:0,y:0,width:300,zIndex:10,contentHTML:'<p>Export keeps text<br>and line breaks</p><img data-asset-id="export-image" src="about:blank" style="width:100px;height:100px">'}]});
    window.ui.getState().setExportOpen(true);
  });
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Экспорт в PNG'}).click();
  const result=await Promise.race([download,page.getByRole('alert').waitFor().then(async()=>{throw new Error(await page.getByRole('alert').textContent());})]);
  assert.match(result.suggestedFilename(),/\.png$/);
  const png=await readFile(await result.path());
  const pixels=await page.evaluate(async base64=>{
    const image=await createImageBitmap(await (await fetch('data:image/png;base64,'+base64)).blob());
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let red=0,dark=0;
    for(let i=0;i<data.length;i+=4){if(data[i]>200&&data[i+1]<30&&data[i+2]<30)red++;if(data[i]<100&&data[i+1]<100&&data[i+2]<100)dark++;}
    return {red,dark};
  },png.toString('base64'));
  assert.ok(pixels.red>20000,`original image must appear in PNG: ${JSON.stringify(pixels)}`);
  assert.ok(pixels.dark>100,'text must appear in PNG');
  await page.evaluate(()=>{
    const current=window.store.getState().textBlocks;
    window.store.setState({textBlocks:[...current,{id:'far',pageId:'other',x:0,y:7000,width:100,zIndex:11,contentHTML:'<p>Last line is retained</p>'}]});
    window.ui.getState().setExportOpen(true);
  });
  const archive=page.waitForEvent('download');
  await page.getByRole('button',{name:'Экспорт в PNG'}).click();
  const zip=await archive; assert.match(zip.suggestedFilename(),/\.zip$/);
  const bytes=await readFile(await zip.path()); assert.equal(bytes.readUInt32LE(0),0x04034b50);
  assert.ok(bytes.includes(Buffer.from('layout.json')));
  assert.deepEqual(errors,[]);
  console.log('Canvas browser: transformed text/focus/caret, full pen input, undo/redo and page leave passed.');
} finally { await browser?.close(); await server.close(); }
