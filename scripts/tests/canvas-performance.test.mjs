import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStroke } from 'perfect-freehand';
import { loadTs } from './helpers/load-ts.mjs';

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
