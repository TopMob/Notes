import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { encode, decode, sealSnapshot, validateSnapshot, inspectRelations, canonical } from './backup-core.mjs';
import { captureTurso } from './cloud-backup.mjs';
import { restoreTursoTemporary } from './restore-turso-temporary.mjs';

test('backup codec preserves text, binary, undefined, dates, keys and special numbers', async () => {
  const raw = { id: 'note', contentHTML: '<table><tr><td>текст 2²</td></tr></table>', blob: new Blob([new Uint8Array([0, 128, 255])], { type: 'image/png' }), file: new File(['text'], 'file.txt', { type: 'text/plain', lastModified: 1234 }), absent: undefined, timestamp: new Date('2020-01-01T00:00:00Z'), number: 12n, minusZero: -0, nan: NaN, view: new Uint16Array([3, 65535]) };
  const result = decode(JSON.parse(JSON.stringify(await encode(raw))));
  assert.equal(result.contentHTML, raw.contentHTML);
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), new Uint8Array([0, 128, 255]));
  assert.equal(result.file.name, 'file.txt'); assert.equal(result.file.lastModified, 1234);
  assert.ok(Object.hasOwn(result, 'absent')); assert.equal(result.absent, undefined);
  assert.equal(result.timestamp.toISOString(), raw.timestamp.toISOString()); assert.equal(result.number, 12n);
  assert.ok(Object.is(result.minusZero, -0)); assert.ok(Number.isNaN(result.nan)); assert.deepEqual(result.view, raw.view);
  const unusual = JSON.parse('{"__proto__":{"polluted":true}}');
  const recovered = decode(await encode(unusual));
  assert.equal(Object.getPrototypeOf(recovered), Object.prototype); assert.equal(recovered.__proto__.polluted, true); assert.equal({}.polluted, undefined);
});

test('corruption and duplicate keys fail validation; relations are reported without changing source', async () => {
  const records = [{ key: await encode('p'), value: await encode({ id: 'p', sectionId: 'missing', slugAliases: ['old'] }) }];
  const snapshot = await sealSnapshot({ kind: 'indexeddb', database: { name: 'test', version: 2 }, source: {}, stores: [{ name: 'pages', schema: { keyPath: 'id', indexes: [], autoIncrement: false }, records }] });
  await validateSnapshot(snapshot);
  assert.equal(inspectRelations(snapshot)[0].missingId, 'missing');
  const before = canonical(snapshot);
  inspectRelations(snapshot); assert.equal(canonical(snapshot), before);
  const corrupt = structuredClone(snapshot); corrupt.stores[0].records[0].value = await encode({ id: 'other' });
  await assert.rejects(validateSnapshot(corrupt), /checksum/);
  const duplicate = structuredClone(snapshot); duplicate.stores[0].records.push(records[0]);
  await assert.rejects(validateSnapshot(duplicate), /Duplicate/);
  await assert.rejects(validateSnapshot({ data: {} }), /Invalid/);
});

test('actual libsql capture/restore preserves cloud rows, bundles, tombstone, binary and schema', async () => {
  const source = createClient({ url: 'file::memory:', intMode: 'bigint' });
  try {
    await source.executeMultiple('CREATE TABLE notebooks (id TEXT PRIMARY KEY, user_id TEXT, title TEXT); CREATE TABLE pages (id TEXT PRIMARY KEY, user_id TEXT, section_id TEXT, title TEXT, deleted_at INTEGER); CREATE TABLE page_elements (id TEXT PRIMARY KEY, page_id TEXT, data BLOB, updated_at INTEGER); CREATE INDEX pages_by_user ON pages(user_id);');
    await source.execute({ sql: 'INSERT INTO notebooks VALUES (?, ?, ?)', args: ['nb', 'fixture', 'Русский блокнот'] });
    await source.execute({ sql: 'INSERT INTO pages VALUES (?, ?, ?, ?, ?)', args: ['p', 'fixture', 'sec', 'Корзина', 1234] });
    await source.execute({ sql: 'INSERT INTO page_elements VALUES (?, ?, ?, ?)', args: ['bundle_p', 'p', new Uint8Array([0, 255, 64]), 1234567890123n] });
    const snapshot = await captureTurso(source);
    const directory = await mkdtemp(join(tmpdir(), 'notes-stage0-tests-'));
    const filename = join(directory, 'notes-stage0-restore-fixture.sqlite');
    const recovered = await restoreTursoTemporary(snapshot, filename);
    assert.equal(recovered.verified, true);
    assert.deepEqual(recovered.counts, { notebooks: 1, page_elements: 1, pages: 1 });
    const beforeOverwrite = await readFile(filename);
    await assert.rejects(restoreTursoTemporary(snapshot, filename));
    assert.deepEqual(await readFile(filename), beforeOverwrite);
    assert.equal(canonical((await captureTurso(source)).manifest), canonical(snapshot.manifest));
    const corrupt = structuredClone(snapshot); corrupt.archiveSha256 = 'bad';
    const rejectedFile = join(directory, 'notes-stage0-restore-corrupt.sqlite');
    await assert.rejects(restoreTursoTemporary(corrupt, rejectedFile));
    await assert.rejects(stat(rejectedFile), { code: 'ENOENT' });
    await assert.rejects(restoreTursoTemporary(snapshot, join(directory, 'production.sqlite')));
  } finally { source.close(); }
});

test('production Turso capture requests read mode and issues SELECT only', async () => {
  const modes = [], sql = [];
  const tx = { execute: async input => {
    sql.push(typeof input === 'string' ? input : input.sql);
    if (sql.at(-1).includes('sqlite_master')) return { columns: ['type', 'name', 'tbl_name', 'sql'], rows: [
      { type: 'table', name: 'notebooks', tbl_name: 'notebooks', sql: 'CREATE TABLE notebooks(id TEXT)' },
      { type: 'table', name: 'pages', tbl_name: 'pages', sql: 'CREATE TABLE pages(id TEXT)' },
    ] };
    return { columns: ['id'], rows: [] };
  }, rollback: async () => {}, close() {} };
  await captureTurso({ transaction: async mode => { modes.push(mode); return tx; } });
  assert.deepEqual(modes, ['read']); assert.ok(sql.every(s => /^SELECT\b/.test(s)));
});
