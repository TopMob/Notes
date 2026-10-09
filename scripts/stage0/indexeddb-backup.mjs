import { encode, decode, sealSnapshot, validateSnapshot, inspectRelations } from './backup-core.mjs';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`IndexedDB request failed: ${request.error?.name || 'unknown'}`));
  });
}
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error(`IndexedDB transaction aborted: ${tx.error?.name || 'unknown'}`));
    tx.onerror = () => {}; // Abort supplies the final error.
  });
}

async function openExisting(name) {
  // Opening without a version avoids upgrades. Abort creation if DB is absent.
  const request = indexedDB.open(name);
  request.onupgradeneeded = () => request.transaction.abort();
  const db = await requestResult(request);
  db.onversionchange = () => db.close();
  return db;
}

export async function captureIndexedDB(name = 'onenote_clone_db') {
  const db = await openExisting(name);
  try {
    const names = Array.from(db.objectStoreNames).sort();
    if (!names.length) throw new Error('Database has no stores');
    // Enqueue ALL reads synchronously in ONE readonly transaction. Do not await
    // Blob encoding/hashing while IDB is active; those happen after tx completes.
    const tx = db.transaction(names, 'readonly');
    const done = transactionDone(tx);
    done.catch(() => {}); // Still awaited below; avoids unhandled rejection on a failed read.
    const pending = names.map(name => {
      const store = tx.objectStore(name);
      const schema = { keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes: Array.from(store.indexNames).sort().map(name => {
        const index = store.index(name);
        return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
      }) };
      return { name, schema, keys: requestResult(store.getAllKeys()), values: requestResult(store.getAll()) };
    });
    const raw = await Promise.all(pending.map(async store => ({ name: store.name, schema: store.schema, keys: await store.keys, values: await store.values })));
    await done;
    const stores = [];
    for (const store of raw) {
      const records = [];
      for (let i = 0; i < store.keys.length; i++) records.push({ key: await encode(store.keys[i]), value: await encode(store.values[i]) });
      stores.push({ name: store.name, schema: store.schema, records });
    }
    const snapshot = await sealSnapshot({ kind: 'indexeddb', createdAt: new Date().toISOString(), source: { origin: location.origin, persistedOnly: true, inMemoryEditsIncluded: false }, database: { name: db.name, version: db.version }, stores });
    await validateSnapshot(snapshot);
    return { snapshot, relationIssues: inspectRelations(snapshot) };
  } finally { db.close(); }
}

export async function downloadIndexedDB(name = 'onenote_clone_db') {
  const result = await captureIndexedDB(name);
  const blob = new Blob([JSON.stringify(result.snapshot)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `notes-stage0-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { manifest: result.snapshot.manifest, relationIssues: result.relationIssues, inMemoryEditsIncluded: false };
}

export async function restoreTemporary(snapshot, name = `notes_stage0_restore_${crypto.randomUUID()}`) {
  await validateSnapshot(snapshot); // Validation always precedes opening/writing.
  if (snapshot.kind !== 'indexeddb' || !/^notes_stage0_restore_[a-zA-Z0-9_-]+$/.test(name) || name === snapshot.database.name) throw new Error('Restore is allowed only into a NEW temporary database');
  if (snapshot.stores.some(s => s.schema.autoIncrement)) throw new Error('Auto-increment generator state cannot be verified by readonly capture; review this store separately');
  // Decode all values before opening the write transaction.
  const stores = snapshot.stores.map(s => ({ ...s, decoded: s.records.map(r => ({ key: decode(r.key), value: decode(r.value) })) }));
  let created = false;
  const request = indexedDB.open(name, snapshot.database.version);
  request.onupgradeneeded = event => {
    if (event.oldVersion !== 0) { request.transaction.abort(); return; }
    created = true;
    for (const source of stores) {
      const store = request.result.createObjectStore(source.name, { keyPath: source.schema.keyPath, autoIncrement: source.schema.autoIncrement });
      for (const index of source.schema.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
    }
  };
  const db = await requestResult(request);
  try {
    if (!created) throw new Error('Refusing to overwrite an existing database');
    const tx = db.transaction(stores.map(s => s.name), 'readwrite', { durability: 'strict' });
    const done = transactionDone(tx);
    done.catch(() => {});
    try {
      for (const source of stores) {
        const store = tx.objectStore(source.name);
        for (const record of source.decoded) {
          if (source.schema.keyPath === null) store.add(record.value, record.key);
          else store.add(record.value);
        }
      }
    } catch (error) { tx.abort(); await done.catch(() => {}); throw error; }
    await done;
  } finally { db.close(); }
  const restored = await captureIndexedDB(name);
  if (restored.snapshot.manifest.contentSha256 !== snapshot.manifest.contentSha256) throw new Error('Restored snapshot differs from source');
  return { name, verified: true, manifest: restored.snapshot.manifest, relationIssues: restored.relationIssues };
}
