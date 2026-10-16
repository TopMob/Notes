import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

// Run the real modules; replace only explicit platform/IO boundaries.
export function loadTs(filename, boundaries = {}, cache = new Map()) {
  const path = resolve(filename);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} };
  cache.set(path, module);
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const localRequire = name => {
    if (Object.hasOwn(boundaries, name)) return boundaries[name];
    if (name.startsWith('.')) return loadTs(resolve(dirname(path), `${name}.ts`), boundaries, cache);
    return require(name);
  };
  Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
  return module.exports;
}
