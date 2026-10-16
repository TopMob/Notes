// CPU microbenchmarks of the actual before/after modules; no personal notes or DB.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { loadTs } from '../tests/helpers/load-ts.mjs';
const require=createRequire(import.meta.url), ts=require('typescript');
const baseline=process.argv[2] || 'fce7292';
function original(path) {
  const source=execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8'});
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}}; Function('require','module','exports',js)(require,module,module.exports); return module.exports;
}
function median(run) {
  run();run();const values=[];
  for(let i=0;i<9;i++){const start=performance.now();run();values.push(performance.now()-start);}
  values.sort((a,b)=>a-b);return +values[4].toFixed(3);
}
let sink=0;
const ctx={save(){},restore(){},beginPath(){},moveTo(x){sink+=x;},lineTo(x){sink+=x;},closePath(){},fill(){}};
const before=original('src/canvas/stroke/freehand.ts').drawStrokeToCanvas;
const after=loadTs('src/canvas/stroke/freehand.ts').drawStrokeToCanvas;
const strokes=Array.from({length:500},(_,i)=>({id:`s${i}`,baseWidth:2,color:'black',opacity:1,blendMode:'source-over',points:Array.from({length:200},(_,j)=>({x:j*1.5,y:Math.sin(j*.17)*18,pressure:.5,t:j}))}));
console.log(JSON.stringify({scenario:'500 committed strokes x 200 points, warm redraw, mocked Canvas commands (no GPU)',baseline, before_ms:median(()=>strokes.forEach(s=>before(ctx,s))),after_ms:median(()=>strokes.forEach(s=>after(ctx,s)))}));
const OldIndex=original('src/canvas/engine/SpatialIndex.ts').SpatialIndex;
const NewIndex=loadTs('src/canvas/engine/SpatialIndex.ts').SpatialIndex;
const items=Array.from({length:10000},(_,i)=>({id:`s${i}`,bounds:{minX:(i%100)*80,minY:Math.floor(i/100)*50,maxX:(i%100)*80+65,maxY:Math.floor(i/100)*50+40}}));
const oldIndex=new OldIndex(),newIndex=new NewIndex();oldIndex.rebuild(items);newIndex.rebuild(items);
console.log(JSON.stringify({scenario:'index update for one moved item among 10000 (array/store/render costs excluded)', before_ms:median(()=>oldIndex.rebuild(items)),after_ms:median(()=>newIndex.insert({...items[0],bounds:{...items[0].bounds,minX:1}}))}));
if(!Number.isFinite(sink))throw Error('Invalid drawing output');
