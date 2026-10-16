import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStroke } from 'perfect-freehand';
import { crc32 } from 'node:zlib';
import { loadTs } from './helpers/load-ts.mjs';

test('PNG tiling preserves all pixels at 2x and ZIP preserves every original byte and CRC', async () => {
  const {planPngTiles,zipFiles}=loadTs('src/utils/pngExport.ts');
  for (const [width,height] of [[1000,1000],[6000,7000],[100,30000]]) {
    const tiles=planPngTiles(width,height);
    assert.equal(tiles.reduce((n,t)=>n+t.width*t.height,0),width*height);
    for(const tile of tiles) {
      assert.ok(tile.width*tile.height*4<=16_777_216);
      assert.ok(tile.x+tile.width<=width && tile.y+tile.height<=height);
    }
  }
  const files=[{name:'page-001.png',blob:new Blob(['original png bytes'])},{name:'layout.json',blob:new Blob(['{"scale":2}'])}];
  const zip=new Uint8Array(await (await zipFiles(files)).arrayBuffer());
  const view=new DataView(zip.buffer);let offset=0;
  for(const file of files) {
    assert.equal(view.getUint32(offset,true),0x04034b50);
    const nameLength=view.getUint16(offset+26,true), size=view.getUint32(offset+18,true);
    const data=zip.slice(offset+30+nameLength,offset+30+nameLength+size);
    assert.deepEqual(data,new Uint8Array(await file.blob.arrayBuffer()));
    assert.equal(view.getUint32(offset+14,true),crc32(data));
    offset+=30+nameLength+size;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);
  assert.equal(view.getUint32(zip.length-22,true),0x06054b50);
});

test('unchanged formulas reuse HTML without replacing their DOM; edits invalidate the cache', () => {
  let calls = 0, writes = 0, html = '';
  const {renderFormulaInto} = loadTs('src/utils/formulaRendering.ts', {
    katex: {default:{renderToString:latex=>{calls++;return `<span>${latex}</span>`;}}},
  });
  const element = { get innerHTML(){return html;}, set innerHTML(value){writes++;html=value;} };
  renderFormulaInto(element,'x^2'); renderFormulaInto(element,'x^2');
  assert.equal(calls,1); assert.equal(writes,1);
  const another = {innerHTML:''}; renderFormulaInto(another,'x^2'); assert.equal(calls,1);
  renderFormulaInto(element,'x^3'); assert.equal(calls,2); assert.equal(html,'<span>x^3</span>');
});

test('no-op camera, text and height updates publish nothing and create no dirty edits', async () => {
  globalThis.localStorage = {getItem:()=>null,setItem(){}};
  const writes=[];
  const {useCanvasStore:store}=loadTs('src/store/useCanvasStore.ts',{
    '../db/storage':{savePageDiff:async(...args)=>writes.push(args),savePageFull:async()=>{},loadPageData:async()=>({})},
  });
  const block={id:'t',pageId:'p',x:1,y:2,width:400,contentHTML:'Keep',zIndex:10};
  store.setState({currentPageId:'p',textBlocks:[block],textBlockHeights:{t:60}});
  const revision=store.getState().getEditRevision(); let notifications=0;
  store.subscribe(()=>notifications++);
  store.getState().setCamera({...store.getState().camera});
  store.getState().setTextBlockHeight('t',60);
  store.getState().updateTextBlock('t',{x:1,contentHTML:'Keep'});
  store.getState().updateTextBlock('missing',{x:100});
  store.getState().clearSelection();
  assert.equal(notifications,0); assert.equal(store.getState().getEditRevision(),revision);
  await store.getState().flushAllSaves(); assert.equal(writes.length,0);
});

test('asset leases protect shared images, release URLs and handle late loads after unmount', async () => {
  let complete;
  const { assetManager: assets } = loadTs('src/services/assets/assetManager.ts', {
    '../../db/idb': {getDB: async()=>({get:()=>new Promise(resolve=>{complete=resolve;})})},
    './imageCompression': {},
  });
  const first = assets.retain('shared'), second = assets.retain('shared');
  const url = assets.registerAsset('shared',new Blob(['original']));
  first(); await Promise.resolve(); assert.equal(assets.getUrl('shared'),url);
  second(); await Promise.resolve(); assert.equal(assets.getUrl('shared'),null);
  const release=assets.retain('late');
  const loading=assets.getOrLoadUrl('late');
  await Promise.resolve(); release(); await Promise.resolve();
  complete({blob:new Blob(['late original'])});
  assert.equal(await loading,null); assert.equal(assets.getUrl('late'),null);
  const pinned=assets.retain('pinned'); assets.registerAsset('pinned',new Blob(['keep']));
  for(let i=0;i<100;i++) assets.registerAsset(`old${i}`,new Blob(['x']));
  assert.ok(assets.getUrl('pinned')); assert.equal(assets.getUrl('old0'),null);
  pinned(); await Promise.resolve();
  for(let i=0;i<100;i++) assets.revoke(`old${i}`);
});

test('incremental spatial index matches brute force across moves, deletes, snapshots and huge bounds', () => {
  const { SpatialIndex, aabbIntersects } = loadTs('src/canvas/engine/SpatialIndex.ts');
  const index = new SpatialIndex(); const items = new Map();
  let seed = 17;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2**32);
  for (let i = 0; i < 500; i++) {
    const id = `s${Math.floor(random()*60)}`;
    if (i % 4 === 0) { items.delete(id); index.remove(id); }
    else {
      const x = random()*10000-5000, y = random()*10000-5000;
      const item = {id,bounds:{minX:x,minY:y,maxX:x+800,maxY:y+700}};
      items.set(id,item); index.insert(item);
    }
    if (i % 7 === 0) index.sync([...items.values()]);
    const x = random()*8000-4000, y = random()*8000-4000;
    const range = {minX:x,minY:y,maxX:x+2000,maxY:y+2000};
    assert.deepEqual(index.query(range).map(x=>x.id).sort(), [...items.values()].filter(x=>aabbIntersects(x.bounds,range)).map(x=>x.id).sort());
  }
  const huge = {id:'huge',bounds:{minX:-1e9,minY:-1e9,maxX:1e9,maxY:1e9}};
  index.insert(huge);
  assert.ok(index.query({minX:0,minY:0,maxX:1,maxY:1}).includes(huge));
  assert.equal(index.query(huge.bounds).length, items.size+1);
  const updated = {...huge,color:'red'}; index.insert(updated);
  assert.equal(index.query({minX:0,minY:0,maxX:1,maxY:1}).find(x=>x.id==='huge'), updated);
  index.sync([]); assert.deepEqual(index.query(huge.bounds), []);
});

test('visual frames coalesce, use latest work and cancel safely on page leave', () => {
  const callbacks = new Map(); let id = 0;
  globalThis.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = key => callbacks.delete(key);
  try {
    const { FrameTask } = loadTs('src/canvas/engine/FrameTask.ts');
    const frame = new FrameTask(); const drawn = [];
    frame.request(() => drawn.push('old'));
    frame.request(() => drawn.push('latest'));
    assert.equal(callbacks.size, 1);
    const [key, callback] = [...callbacks][0]; callbacks.delete(key); callback();
    assert.deepEqual(drawn, ['latest']);
    frame.request(() => drawn.push('closed page')); frame.cancel();
    assert.equal(callbacks.size, 0);
    frame.request(() => drawn.push('new page'));
    [...callbacks.values()][0]();
    assert.deepEqual(drawn, ['latest', 'new page']);
  } finally { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
});

test('stroke geometry is identical, reused across camera/style changes and invalidated on edits', () => {
  let calls = 0;
  const { drawStrokeToCanvas } = loadTs('src/canvas/stroke/freehand.ts', {
    'perfect-freehand': { getStroke: (...args) => { calls++; return getStroke(...args); } },
  });
  const paths = [];
  const ctx = { save() {}, restore() {}, beginPath() { paths.push([]); }, moveTo(...p) { paths.at(-1).push(p); }, lineTo(...p) { paths.at(-1).push(p); }, closePath() {}, fill() {} };
  const points = Array.from({length: 100}, (_, i) => ({ x:i, y:Math.sin(i / 5) * 10, pressure:.5, t:i }));
  const stroke = { points, baseWidth:3, color:'black', opacity:1, blendMode:'source-over' };
  drawStrokeToCanvas(ctx, stroke);
  assert.deepEqual(paths[0], getStroke(points.map(p => [p.x,p.y,p.pressure]), {size:3,thinning:0,smoothing:.6,streamline:.4,easing:t=>t,simulatePressure:false}));
  drawStrokeToCanvas(ctx, {...stroke, color:'red', opacity:.35, blendMode:'multiply'});
  assert.equal(calls, 1);
  assert.deepEqual(paths[1], paths[0]);
  drawStrokeToCanvas(ctx, {...stroke, baseWidth:8});
  assert.equal(calls, 2);
  drawStrokeToCanvas(ctx, {...stroke, points: points.map(p => ({...p,x:p.x+5}))});
  assert.equal(calls, 3);
  points.push({x:102,y:2,pressure:.5,t:101});
  drawStrokeToCanvas(ctx, stroke);
  assert.equal(calls, 4);
});
