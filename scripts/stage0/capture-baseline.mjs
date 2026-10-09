import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
if (args[0] !== '--out' || args.length !== 2) throw new Error('Usage: node scripts/stage0/capture-baseline.mjs --out <NEW directory>');
const output = resolve(args[1]);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const files = ['package.json', 'package-lock.json', 'src/db/idb.ts', 'src/db/initialData.ts', 'scripts/init-turso.mjs', 'scripts/apply-supabase-rls.sql'];
await mkdir(output, { recursive: false });
const hashes = {};
for (const name of files) {
  const bytes = await readFile(name);
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
  const target = resolve(output, name);
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
}
const variables = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'VITE_TURSO_DATABASE_URL', 'VITE_TURSO_AUTH_TOKEN', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
const projectPackage = JSON.parse(await readFile('package.json', 'utf8'));
const installedDependencies = {};
for (const name of [...Object.keys(projectPackage.dependencies || {}), ...Object.keys(projectPackage.devDependencies || {})]) {
  installedDependencies[name] = { version: JSON.parse(await readFile(resolve('node_modules', name, 'package.json'), 'utf8')).version };
}
const baseline = { capturedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), workingTree: git('status', '--short'), runtime: { node: process.version }, files: hashes,
  installedDependencies,
  expectedLocalSchema: { sourceOnly: true, name: 'onenote_clone_db', version: 2, stores: ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks', 'assets'] },
  credentialsAvailable: Object.fromEntries(variables.map(name => [name, Boolean(process.env[name])])),
  actualLocalSchemaVerified: false, actualCloudSchemaVerified: false, actualPermissionsVerified: false };
await writeFile(resolve(output, 'baseline.json'), JSON.stringify(baseline, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ baselineCaptured: true, output, commit: baseline.commit, productionDataCaptured: false }));
