import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { versionHash, assetIds, portableElements } from '../src/services/sync/protocol.mjs';

export class SyncError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const tables = new Set(['notebooks', 'sections', 'pages']);
export function decode(data) {
  if (typeof data !== 'string') throw new SyncError(502, 'Повреждённый облачный пакет');
  return JSON.parse(data.startsWith('gz:') ? gunzipSync(Buffer.from(data.slice(3), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }).toString() : data);
}
export function pack(value) { return `gz:${gzipSync(JSON.stringify(value)).toString('base64')}`; }
function record(entity, r) {
  if (!r) return null;
  const common = { id: String(r.id), title: String(r.title), order: Number(r.order), updatedAt: Number(r.updated_at), deletedAt: r.deleted_at ? Number(r.deleted_at) : null };
  if (entity === 'notebooks') return { ...common, createdAt: Number(r.created_at) };
  if (entity === 'sections') return { ...common, notebookId: String(r.notebook_id), color: String(r.color) };
  return { ...common, sectionId: String(r.section_id), createdAt: Number(r.created_at), camera: r.camera ? JSON.parse(r.camera) : { x: 0, y: 0, zoom: 1 }, background: r.background ? JSON.parse(r.background) : 'grid-small' };
}
export function elementsFromRows(rows) {
  const bundles = new Map();
  for (const row of rows) if (row.type === 'bundle' && (!bundles.has(row.page_id) || Number(row.updated_at) > Number(bundles.get(row.page_id).updated_at))) bundles.set(row.page_id, row);
  const result = [];
  for (const row of rows) {
    if (row.type === 'bundle') {
      if (bundles.get(row.page_id) !== row || row.deleted_at) continue;
      const bundle = decode(row.data);
      for (const [key, type] of [['strokes', 'stroke'], ['shapes', 'shape'], ['textBlocks', 'textBlock']]) {
        if (!Array.isArray(bundle[key])) throw new SyncError(502, 'Неполный облачный пакет');
        for (const data of bundle[key]) result.push({ id: data.id, pageId: String(row.page_id), type, data, updatedAt: Number(row.updated_at), deletedAt: null });
      }
    } else if (!bundles.has(row.page_id)) {
      if (!['stroke', 'shape', 'textBlock'].includes(row.type)) throw new SyncError(502, 'Неизвестный облачный элемент');
      result.push({ id: String(row.id), pageId: String(row.page_id), type: row.type, data: row.deleted_at ? null : decode(row.data), updatedAt: Number(row.updated_at), deletedAt: row.deleted_at ? Number(row.deleted_at) : null });
    }
  }
  return result;
}
export async function pull(client, userId) {
  const results = await client.batch(['notebooks', 'sections', 'pages', 'page_elements'].map(table => ({ sql: `SELECT * FROM ${table} WHERE user_id = ?`, args: [userId] })), 'read');
  return { notebooks: results[0].rows.map(r => record('notebooks', r)), sections: results[1].rows.map(r => record('sections', r)), pages: results[2].rows.map(r => record('pages', r)), elements: elementsFromRows(results[3].rows), guarded: true, completePageIds: results[3].rows.filter(r => r.type === 'bundle' && !r.deleted_at).map(r => String(r.page_id)) };
}
function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 300; }
function validateWrite(input) {
  if (!input || !tables.has(input.entity) || !validId(input.id) || !['put', 'delete'].includes(input.action) || input.expected !== null && !/^[a-f0-9]{64}$/.test(input.expected || '')) throw new SyncError(400, 'Некорректная операция');
  if (input.action === 'put') {
    const r = input.record;
    if (!r || r.id !== input.id || typeof r.title !== 'string' || r.title.length > 10000 || !Number.isFinite(r.order)) throw new SyncError(400, 'Некорректный объект');
    if (input.entity !== 'sections' && !Number.isFinite(r.createdAt)) throw new SyncError(400, 'Некорректная дата');
    if (input.entity === 'sections' && (!validId(r.notebookId) || typeof r.color !== 'string')) throw new SyncError(400, 'Некорректный раздел');
    if (input.entity === 'pages') {
      if (!validId(r.sectionId) || !r.camera || !Number.isFinite(r.camera.zoom) || r.camera.zoom <= 0 || !Number.isFinite(r.camera.x) || !Number.isFinite(r.camera.y) || !input.elements) throw new SyncError(400, 'Некорректная страница');
      const ids = new Set();
      for (const key of ['strokes', 'shapes', 'textBlocks']) {
        if (!Array.isArray(input.elements[key])) throw new SyncError(400, 'Неполный холст');
        for (const row of input.elements[key]) {
          if (!row || !validId(row.id) || row.pageId !== input.id || ids.has(row.id)) throw new SyncError(400, 'Некорректная связь элемента');
          ids.add(row.id);
        }
      }
    }
  }
}
async function current(tx, userId, entity, id) {
  const result = await tx.execute({ sql: `SELECT * FROM ${entity} WHERE id = ?`, args: [id] });
  const row = result.rows[0];
  if (row && row.user_id !== userId) throw new SyncError(409, 'ID объекта уже занят');
  let elements;
  if (entity === 'pages') {
    const result = await tx.execute({ sql: 'SELECT * FROM page_elements WHERE page_id = ? AND user_id = ?', args: [id, userId] });
    const decoded = elementsFromRows(result.rows);
    elements = { strokes: [], shapes: [], textBlocks: [] };
    for (const el of decoded) if (!el.deletedAt) elements[{ stroke: 'strokes', shape: 'shapes', textBlock: 'textBlocks' }[el.type]].push(el.data);
  }
  return { record: record(entity, row), elements };
}
export async function commit(client, userId, input) {
  validateWrite(input);
  const elements = input.entity === 'pages' ? portableElements(input.elements) : undefined;
  // Compression and validation precede the write lock.
  const packed = elements ? `gz:${gzipSync(JSON.stringify({ schema_version: 2, ...elements })).toString('base64')}` : null;
  const tx = await client.transaction('write');
  try {
    const existing = await current(tx, userId, input.entity, input.id);
    const actual = await versionHash(input.entity, existing.record, existing.elements);
    const desiredRecord = input.action === 'delete' ? existing.record && { ...existing.record, deletedAt: 1 } : { ...input.record, deletedAt: null };
    const desired = await versionHash(input.entity, desiredRecord, elements);
    // A lost response may be retried without rewriting already committed content.
    if (actual === desired) { await tx.commit(); return { revision: actual }; }
    if (actual !== input.expected) throw new SyncError(409, 'Облако изменилось на другом устройстве. Обе версии сохранены; выберите вариант в настройках синхронизации.');
    const now = Date.now();
    if (input.action === 'delete') {
      // Children carry their own queued operations and revisions: no unguarded cascade.
      await tx.execute({ sql: `UPDATE ${input.entity} SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`, args: [now, now, input.id, userId] });
    } else {
      const r = input.record;
      if (input.entity !== 'notebooks') {
        const parent = input.entity === 'pages' ? 'sections' : 'notebooks';
        const id = input.entity === 'pages' ? r.sectionId : r.notebookId;
        const result = await tx.execute({ sql: `SELECT id FROM ${parent} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, args: [id, userId] });
        if (!result.rows.length) throw new SyncError(409, 'Родительский объект отсутствует или удалён. Локальные данные сохранены.');
      }
      if (input.entity === 'notebooks') await tx.execute({ sql: 'INSERT INTO notebooks(id,user_id,title,created_at,updated_at,"order",deleted_at) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET title=excluded.title,"order"=excluded."order",updated_at=excluded.updated_at,deleted_at=NULL WHERE notebooks.user_id=excluded.user_id', args: [r.id, userId, r.title, r.createdAt, now, r.order] });
      if (input.entity === 'sections') await tx.execute({ sql: 'INSERT INTO sections(id,user_id,notebook_id,title,color,"order",updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET notebook_id=excluded.notebook_id,title=excluded.title,color=excluded.color,"order"=excluded."order",updated_at=excluded.updated_at,deleted_at=NULL WHERE sections.user_id=excluded.user_id', args: [r.id, userId, r.notebookId, r.title, r.color, r.order, now] });
      if (input.entity === 'pages') {
        for (const id of assetIds(elements)) if (!await assetManifest(tx, userId, id)) throw new SyncError(409, 'Изображение ещё не отправлено. Страница остаётся в очереди.');
        await tx.execute({ sql: 'INSERT INTO pages(id,user_id,section_id,title,created_at,updated_at,"order",camera,background,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET section_id=excluded.section_id,title=excluded.title,"order"=excluded."order",camera=excluded.camera,background=excluded.background,updated_at=excluded.updated_at,deleted_at=NULL WHERE pages.user_id=excluded.user_id', args: [r.id, userId, r.sectionId, r.title, r.createdAt, now, r.order, JSON.stringify(r.camera), JSON.stringify(r.background)] });
        const bundleId = `bundle_${r.id}`;
        const collision = await tx.execute({ sql: 'SELECT user_id FROM page_elements WHERE id=?', args: [bundleId] });
        if (collision.rows[0] && collision.rows[0].user_id !== userId) throw new SyncError(409, 'ID содержимого уже занят');
        await tx.execute({ sql: 'INSERT INTO page_elements(id,user_id,page_id,type,data,updated_at,deleted_at) VALUES(?,?,?,\'bundle\',?,?,NULL) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,deleted_at=NULL WHERE page_elements.user_id=excluded.user_id', args: [bundleId, userId, r.id, packed, now] });
      }
    }
    const final = await current(tx, userId, input.entity, input.id);
    const revision = await versionHash(input.entity, final.record, final.elements);
    await tx.commit(); return { revision };
  } finally { tx.close(); }
}
const assetSetup = new WeakMap();
export async function ensureAssets(client) {
  if (!assetSetup.has(client)) {
    const setup = client.batch([
      'CREATE TABLE IF NOT EXISTS notes_asset_chunks(user_id TEXT NOT NULL,id TEXT NOT NULL,part INTEGER NOT NULL,total INTEGER NOT NULL,hash TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(user_id,id,part))',
      'CREATE TABLE IF NOT EXISTS notes_asset_manifests(user_id TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,mime TEXT NOT NULL,total INTEGER NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(user_id,id))',
    ], 'write');
    assetSetup.set(client, setup);
    void setup.catch(() => assetSetup.delete(client));
  }
  await assetSetup.get(client);
}
export async function assetManifest(client, userId, id) {
  const result = await client.execute({ sql: 'SELECT hash,mime,total,size FROM notes_asset_manifests WHERE user_id=? AND id=?', args: [userId, id] });
  return result.rows[0] || null;
}
export async function completeAsset(client, userId, id) {
  const result = await client.execute({ sql: 'SELECT part,total,hash,mime,data FROM notes_asset_chunks WHERE user_id=? AND id=? ORDER BY part', args: [userId, id] });
  if (!result.rows.length) return null;
  const first = result.rows[0];
  if (result.rows.length !== Number(first.total) || result.rows.some((r, i) => Number(r.part) !== i || r.hash !== first.hash || r.total !== first.total)) return null;
  const data = Buffer.concat(result.rows.map(r => Buffer.from(r.data)));
  if (createHash('sha256').update(data).digest('hex') !== first.hash) throw new SyncError(502, 'Контрольная сумма изображения не совпала');
  return { data, mime: first.mime, hash: first.hash };
}
export async function putAsset(client, userId, input, data) {
  if (!validId(input.id) || !Number.isInteger(input.part) || !Number.isInteger(input.total) || input.total < 1 || input.total > 128 || input.part < 0 || input.part >= input.total || !/^[a-f0-9]{64}$/.test(input.hash || '') || !/^image\/(png|jpeg|webp|gif|avif|bmp|x-icon)$/.test(input.mime || '') || !Buffer.isBuffer(data) || data.length > 512 * 1024) throw new SyncError(400, 'Некорректная часть изображения');
  const tx = await client.transaction('write');
  try {
    const existing = await tx.execute({ sql: 'SELECT hash,total FROM notes_asset_chunks WHERE user_id=? AND id=? LIMIT 1', args: [userId, input.id] });
    if (existing.rows[0] && (existing.rows[0].hash !== input.hash || Number(existing.rows[0].total) !== input.total)) throw new SyncError(409, 'ID изображения связан с другим содержимым');
    if (await assetManifest(tx, userId, input.id)) {
      const part = await tx.execute({ sql: 'SELECT data FROM notes_asset_chunks WHERE user_id=? AND id=? AND part=?', args: [userId, input.id, input.part] });
      if (!part.rows[0] || !Buffer.from(part.rows[0].data).equals(data)) throw new SyncError(409, 'Подтверждённое изображение неизменяемо');
      await tx.commit(); return;
    }
    await tx.execute({ sql: 'INSERT INTO notes_asset_chunks(user_id,id,part,total,hash,mime,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,id,part) DO UPDATE SET data=excluded.data', args: [userId, input.id, input.part, input.total, input.hash, input.mime, data] });
    const count = await tx.execute({ sql: 'SELECT count(*) AS count FROM notes_asset_chunks WHERE user_id=? AND id=?', args: [userId, input.id] });
    if (Number(count.rows[0].count) === input.total) {
      const asset = await completeAsset(tx, userId, input.id);
      if (!asset) throw new SyncError(409, 'Изображение ещё не собрано');
      await tx.execute({ sql: 'INSERT INTO notes_asset_manifests(user_id,id,hash,mime,total,size) VALUES(?,?,?,?,?,?)', args: [userId, input.id, asset.hash, asset.mime, input.total, asset.data.length] });
    }
    await tx.commit();
  } finally { tx.close(); }
}
