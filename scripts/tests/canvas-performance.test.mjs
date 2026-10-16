import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStroke } from 'perfect-freehand';
import { loadTs } from './helpers/load-ts.mjs';

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
