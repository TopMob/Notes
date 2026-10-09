import { createClient } from '@libsql/client';
import { authenticate } from '../server/sync-auth.mjs';
import { pull, commit, ensureAssets, putAsset, assetManifest, decode, pack, SyncError } from '../server/turso-sync.mjs';
let client;
function database() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new SyncError(503, 'Серверное подключение Turso не настроено');
    client = createClient({ url, authToken });
  }
  return client;
}
async function binaryBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 512 * 1024) throw new SyncError(413, 'Слишком большая часть изображения');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const userId = await authenticate(req.headers);
    const db = database();
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || Buffer.byteLength(JSON.stringify(body)) > 3 * 1024 * 1024) throw new SyncError(413, 'Облачный пакет слишком большой; локальные данные сохранены');
      if (body.action === 'pull') {
        const payload = pack(await pull(db, userId));
        if (Buffer.byteLength(payload) > 3 * 1024 * 1024) throw new SyncError(413, 'Снимок превышает лимит передачи. Локальные заметки сохранены.');
        return res.status(200).json({ payload });
      }
      if (body.action === 'commit') return res.status(200).json(await commit(db, userId, decode(body.payload)));
      throw new SyncError(400, 'Неизвестная операция');
    }
    if (req.method === 'PUT') {
      await ensureAssets(db);
      await putAsset(db, userId, { id: req.query.id, part: Number(req.query.part), total: Number(req.query.total), hash: req.query.hash, mime: req.headers['x-asset-mime'] }, await binaryBody(req));
      return res.status(200).json({ saved: true });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && typeof req.query.id === 'string') {
      await ensureAssets(db);
      const manifest = await assetManifest(db, userId, req.query.id);
      if (!manifest) throw new SyncError(404, 'Изображение отсутствует или ещё не отправлено');
      res.setHeader('X-Asset-Hash', manifest.hash); res.setHeader('X-Asset-Parts', String(manifest.total)); res.setHeader('X-Asset-Size', String(manifest.size)); res.setHeader('Content-Type', manifest.mime);
      if (req.method === 'HEAD') {
        return res.status(200).end();
      }
      const part = Number(req.query.part);
      if (!Number.isInteger(part) || part < 0 || part >= Number(manifest.total)) throw new SyncError(400, 'Некорректная часть изображения');
      const result = await db.execute({ sql: 'SELECT data FROM notes_asset_chunks WHERE user_id=? AND id=? AND part=?', args: [userId, req.query.id, part] });
      if (!result.rows[0]) throw new SyncError(502, 'Часть изображения отсутствует');
      return res.status(200).send(Buffer.from(result.rows[0].data));
    }
    throw new SyncError(405, 'Метод не поддерживается');
  } catch (error) {
    const status = error instanceof SyncError ? error.status : 502;
    return res.status(status).json({ error: error instanceof SyncError ? error.message : 'Облачная операция не завершена; локальные данные и очередь сохранены' });
  }
}
