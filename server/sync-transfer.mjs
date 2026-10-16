import { createHash, randomUUID } from 'node:crypto';
import { SyncError } from './turso-sync.mjs';

// Temporary transport data only; authoritative notes are committed separately.
export const TRANSFER_PART_SIZE = 256 * 1024;
const MAX_PARTS = 256;
const LIFETIME = 15 * 60 * 1000;
const hashOf = data => createHash('sha256').update(data).digest('hex');
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);

async function prepare(client, userId) {
  await client.execute(`CREATE TABLE IF NOT EXISTS notes_transfer_chunks (
    user_id TEXT NOT NULL, id TEXT NOT NULL, part INTEGER NOT NULL,
    total INTEGER NOT NULL, hash TEXT NOT NULL, purpose TEXT NOT NULL,
    data TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,id,part))`);
  await client.execute({ sql: 'DELETE FROM notes_transfer_chunks WHERE user_id=? AND created_at<?', args: [userId, Date.now() - LIFETIME] });
}

export async function releaseTransfer(client, userId, id) {
  if (!validId(id)) throw new SyncError(400, 'Некорректная передача заметки');
  await client.execute({ sql: 'DELETE FROM notes_transfer_chunks WHERE user_id=? AND id=?', args: [userId, id] });
}

export async function createSnapshotTransfer(client, userId, payload) {
  await prepare(client, userId);
  const id = randomUUID(), hash = hashOf(payload);
  const total = Math.max(1, Math.ceil(payload.length / TRANSFER_PART_SIZE));
  if (total > MAX_PARTS) throw new SyncError(413, 'Облачный снимок слишком велик для текущей версии синхронизации. Локальные заметки сохранены.');
  const now = Date.now();
  await client.batch(Array.from({ length: total }, (_, part) => ({
    sql: 'INSERT INTO notes_transfer_chunks(user_id,id,part,total,hash,purpose,data,created_at) VALUES(?,?,?,?,?,?,?,?)',
    args: [userId, id, part, total, hash, 'pull', payload.slice(part * TRANSFER_PART_SIZE, (part + 1) * TRANSFER_PART_SIZE), now],
  })), 'write');
  return { id, hash, total, part: 0, data: payload.slice(0, TRANSFER_PART_SIZE) };
}

export async function readSnapshotPart(client, userId, id, part) {
  if (!validId(id) || !Number.isInteger(part) || part < 0 || part >= MAX_PARTS) throw new SyncError(400, 'Некорректная часть снимка');
  await prepare(client, userId);
  const result = await client.execute({ sql: "SELECT data,hash,total FROM notes_transfer_chunks WHERE user_id=? AND id=? AND part=? AND purpose='pull'", args: [userId, id, part] });
  const row = result.rows[0];
  if (!row) throw new SyncError(410, 'Передача снимка истекла или не найдена. Повторите синхронизацию.');
  return { id, part, total: Number(row.total), hash: row.hash, data: row.data };
}

export async function uploadCommitPart(client, userId, input) {
  const { id, part, total, hash, data } = input;
  if (!validId(id) || !Number.isInteger(total) || total < 1 || total > MAX_PARTS || !Number.isInteger(part) || part < 0 || part >= total || !/^[a-f0-9]{64}$/.test(hash || '') || typeof data !== 'string' || data.length > TRANSFER_PART_SIZE) throw new SyncError(400, 'Некорректная часть отправляемой заметки');
  await prepare(client, userId);
  const tx = await client.transaction('write');
  try {
    const rows = await tx.execute({ sql: 'SELECT total,hash,purpose FROM notes_transfer_chunks WHERE user_id=? AND id=? LIMIT 1', args: [userId, id] });
    const previous = rows.rows[0];
    if (previous && (Number(previous.total) !== total || previous.hash !== hash || previous.purpose !== 'commit')) throw new SyncError(409, 'Версия отправляемой заметки изменилась');
    await tx.execute({ sql: "INSERT INTO notes_transfer_chunks(user_id,id,part,total,hash,purpose,data,created_at) VALUES(?,?,?,?,?,'commit',?,?) ON CONFLICT(user_id,id,part) DO UPDATE SET data=excluded.data", args: [userId, id, part, total, hash, data, Date.now()] });
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}

export async function readCommitTransfer(client, userId, id) {
  if (!validId(id)) throw new SyncError(400, 'Некорректная передача заметки');
  await prepare(client, userId);
  const result = await client.execute({ sql: "SELECT part,total,hash,data FROM notes_transfer_chunks WHERE user_id=? AND id=? AND purpose='commit' ORDER BY part", args: [userId, id] });
  const rows = result.rows, first = rows[0];
  if (!first || rows.length !== Number(first.total) || rows.some((row, index) => Number(row.part) !== index || row.hash !== first.hash || Number(row.total) !== Number(first.total))) throw new SyncError(409, 'Заметка отправлена не полностью. Локальная версия и очередь сохранены.');
  const payload = rows.map(row => row.data).join('');
  if (hashOf(payload) !== first.hash) throw new SyncError(409, 'Контрольная сумма заметки не совпала. Локальная версия сохранена.');
  return payload;
}
