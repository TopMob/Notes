// Cloud snapshot tool. Production path performs only read-only Turso operations.
// Credentials come from environment, never from arguments or log output.
import { createClient } from '@libsql/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode, sealSnapshot, validateSnapshot } from './backup-core.mjs';

export const APP_TABLES = ['notebooks', 'sections', 'pages', 'page_elements', 'notes_sync_state', 'assets'];

export async function captureTurso(client) {
  const tx = await client.transaction('read');
  try {
    const schema = await tx.execute("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name");
    const entries = schema.rows.map(r => Object.fromEntries(schema.columns.map(c => [c, r[c]]))).filter(r => APP_TABLES.includes(r.tbl_name));
    const tables = entries.filter(r => r.type === 'table');
    if (!tables.some(t => t.name === 'notebooks') || !tables.some(t => t.name === 'pages')) throw new Error('Expected Notes schema not found');
    const stores = [];
    for (const table of tables) {
      // Names are restricted to the constant allowlist, not supplied SQL.
      const result = await tx.execute(`SELECT * FROM "${table.name}"`);
      const records = [];
      for (const row of result.rows) {
        const raw = Object.fromEntries(result.columns.map(column => [column, row[column]]));
        const key = raw.id ?? raw.user_id;
        if (key === undefined) throw new Error('Table has no supported stable key');
        records.push({ key: await encode(key), value: await encode(raw) });
      }
      records.sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key), 'en'));
      stores.push({ name: table.name, schema: { keyPath: null, autoIncrement: false, indexes: [], sql: table.sql, columns: result.columns, definitions: entries.filter(r => r.tbl_name === table.name) }, records });
    }
    await tx.rollback(); // End read transaction; no writes to source database.
    const snapshot = await sealSnapshot({ kind: 'turso', createdAt: new Date().toISOString(), source: { consistency: 'read-transaction', scope: 'Notes tables visible to configured credential', permissionsVerified: false }, database: { name: 'Notes cloud', version: 1 }, stores });
    await validateSnapshot(snapshot);
    return snapshot;
  } finally { tx.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== '--out' || args.length !== 2) throw new Error('Usage: node scripts/stage0/cloud-backup.mjs --out <NEW directory>');
  const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('Turso configuration unavailable. No cloud connection attempted.');
  if (!/^libsql:\/\/|^https:\/\//.test(url)) throw new Error('Production capture requires a remote HTTPS/libsql endpoint');
  const output = resolve(args[1]);
  await mkdir(output); // Refuse to overwrite an existing backup directory.
  const client = createClient({ url: url.replace(/^libsql:/, 'https:'), authToken, intMode: 'bigint', fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) });
  try {
    const snapshot = await captureTurso(client);
    await writeFile(resolve(output, 'turso-snapshot.json'), JSON.stringify(snapshot), { flag: 'wx' });
    await writeFile(resolve(output, 'manifest.json'), JSON.stringify(snapshot.manifest, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ captured: true, counts: Object.fromEntries(snapshot.stores.map(s => [s.name, s.records.length])), permissionsVerified: false, restoreVerified: false }));
  } finally { client.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Cloud capture failed. Configuration, permissions and connectivity must be checked privately; raw server errors are not logged.'); process.exitCode = 1; });
}
