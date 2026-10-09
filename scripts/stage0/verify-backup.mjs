import { readFile } from 'node:fs/promises';
import { validateSnapshot, inspectRelations } from './backup-core.mjs';
const filename = process.argv[2];
if (!filename) throw new Error('Usage: node scripts/stage0/verify-backup.mjs <snapshot.json>');
try {
  const snapshot = JSON.parse(await readFile(filename, 'utf8'));
  const manifest = await validateSnapshot(snapshot);
  console.log(JSON.stringify({ verified: true, kind: snapshot.kind, contentSha256: manifest.contentSha256, counts: Object.fromEntries(Object.entries(manifest.stores).map(([name, store]) => [name, store.count])), relationIssues: snapshot.kind === 'indexeddb' ? inspectRelations(snapshot) : [], inMemoryEditsIncluded: snapshot.source.inMemoryEditsIncluded ?? null }, null, 2));
} catch { console.error('Snapshot validation failed. No database was opened or changed.'); process.exitCode = 1; }
