import { createClient } from '@libsql/client';
import { open, readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { decode, validateSnapshot, canonical } from './backup-core.mjs';
import { captureTurso, APP_TABLES } from './cloud-backup.mjs';

export async function restoreTursoTemporary(snapshot, filename) {
  await validateSnapshot(snapshot);
  if (snapshot.kind !== 'turso' || !/^notes-stage0-restore-[\w-]+\.sqlite$/.test(basename(filename))) throw new Error('Only a NEW notes-stage0-restore-*.sqlite file may be used');
  if (snapshot.stores.some(s => !APP_TABLES.includes(s.name))) throw new Error('Unexpected cloud table');
  const target = resolve(filename);
  const guard = await open(target, 'wx'); // Atomic exclusive creation prevents overwrite.
  await guard.close();
  const client = createClient({ url: pathToFileURL(target).href, intMode: 'bigint' });
  try {
    const tx = await client.transaction('write'); // Only the new local test file.
    try {
      for (const store of snapshot.stores) {
        if (!/^CREATE TABLE\b/i.test(store.schema.sql)) throw new Error('Unsupported table definition');
        await tx.execute(store.schema.sql);
      }
      for (const store of snapshot.stores) {
        const columns = store.schema.columns;
        if (!Array.isArray(columns) || columns.some(c => typeof c !== 'string' || !/^[\w]+$/.test(c))) throw new Error('Unsupported column name');
        for (const record of store.records) {
          const value = decode(record.value);
          await tx.execute({ sql: `INSERT INTO "${store.name}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`, args: columns.map(c => value[c]) });
        }
      }
      for (const store of snapshot.stores) for (const definition of store.schema.definitions) {
        if (definition.type === 'table') continue;
        if (definition.type !== 'index' || !/^CREATE (?:UNIQUE )?INDEX\b/i.test(definition.sql)) throw new Error('Unsupported non-table schema definition; review before restoring');
        await tx.execute(definition.sql);
      }
      await tx.commit();
    } finally { tx.close(); }
    const recovered = await captureTurso(client);
    if (canonical(recovered.manifest) !== canonical(snapshot.manifest)) throw new Error('Cloud restore verification failed');
    return { verified: true, counts: Object.fromEntries(recovered.stores.map(s => [s.name, s.records.length])), manifest: recovered.manifest };
  } finally { client.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--snapshot' || args[2] !== '--out') throw new Error('Usage: node scripts/stage0/restore-turso-temporary.mjs --snapshot <JSON> --out <NEW notes-stage0-restore-*.sqlite>');
  try {
    const snapshot = JSON.parse(await readFile(args[1], 'utf8'));
    console.log(JSON.stringify(await restoreTursoTemporary(snapshot, args[3])));
  } catch { console.error('Temporary restore failed; no existing database was overwritten.'); process.exitCode = 1; }
}
