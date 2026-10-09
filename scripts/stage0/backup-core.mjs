// Standalone backup format. No imports from the application and no network calls.
export const FORMAT = 'notes-stage0-snapshot';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}

function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

function unbase64(text) {
  const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
  if (base64(bytes) !== text) throw new Error('Non-canonical binary encoding');
  return bytes;
}

// Tagged values preserve undefined, special numbers and binary types without collisions
// with user objects. Unsupported types fail loudly instead of silently dropping data.
export async function encode(value) {
  if (value === undefined) return ['undefined'];
  if (value === null) return ['null'];
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  if (value instanceof Date) return ['date', value.toISOString()];
  if (value instanceof File) return ['file', value.type, value.name, value.lastModified, base64(new Uint8Array(await value.arrayBuffer()))];
  if (value instanceof Blob) return ['blob', value.type, base64(new Uint8Array(await value.arrayBuffer()))];
  if (value instanceof ArrayBuffer) return ['buffer', base64(new Uint8Array(value))];
  if (ArrayBuffer.isView(value)) return ['view', value.constructor.name, base64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))];
  if (Array.isArray(value)) return ['array', await Promise.all(value.map(encode))];
  if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    return ['object', await Promise.all(Object.keys(value).sort().map(async key => [key, await encode(value[key])]))];
  }
  throw new Error('Unsupported backup value type');
}

export function decode(value) {
  if (!Array.isArray(value)) throw new Error('Invalid encoded value');
  const [tag, a, b, c, d] = value;
  switch (tag) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'string': if (typeof a !== 'string') break; return a;
    case 'boolean': if (typeof a !== 'boolean') break; return a;
    case 'number': if (typeof a !== 'string' || !['NaN', 'Infinity', '-Infinity', '-0'].includes(a) && String(Number(a)) !== a) break; return Number(a);
    case 'bigint': return BigInt(a);
    case 'date': return new Date(a);
    case 'blob': return new Blob([unbase64(b)], { type: a });
    case 'file': return new File([unbase64(d)], b, { type: a, lastModified: c });
    case 'buffer': return unbase64(a).buffer;
    case 'view': {
      const allowed = ['Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'DataView'];
      if (!allowed.includes(a)) break;
      return new globalThis[a](unbase64(b).buffer);
    }
    case 'array': return b === undefined && Array.isArray(a) ? a.map(decode) : invalid();
    case 'object': {
      if (!Array.isArray(a)) break;
      const result = {};
      const seen = new Set();
      for (const [key, item] of a) {
        if (typeof key !== 'string' || seen.has(key)) return invalid();
        seen.add(key);
        Object.defineProperty(result, key, { value: decode(item), enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
  }
  return invalid();
}
function invalid() { throw new Error('Invalid backup value'); }

export async function buildManifest(snapshot) {
  const stores = {};
  for (const store of snapshot.stores) {
    const records = [];
    for (const record of store.records) {
      const raw = decode(record.value);
      const item = { key: record.key, sha256: await sha256(canonical(record)) };
      if (raw && typeof raw === 'object' && typeof raw.id === 'string') item.id = raw.id;
      if (raw && typeof raw === 'object' && raw.deletedAt) item.inTrash = true;
      if (raw?.blob instanceof Blob) {
        item.binaryBytes = raw.blob.size;
        item.binarySha256 = await sha256(await raw.blob.arrayBuffer());
      }
      records.push(item);
    }
    stores[store.name] = { count: records.length, schemaSha256: await sha256(canonical(store.schema)), records };
  }
  return { algorithm: 'SHA-256', stores, contentSha256: await sha256(canonical({ version: snapshot.database.version, stores: snapshot.stores })) };
}

export async function sealSnapshot(snapshot) {
  const body = { format: FORMAT, formatVersion: 1, ...snapshot };
  body.manifest = await buildManifest(body);
  body.archiveSha256 = await sha256(canonical(body));
  return body;
}

export async function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.format !== FORMAT || snapshot.formatVersion !== 1 || !snapshot.database || !Number.isInteger(snapshot.database.version) || snapshot.database.version < 1 || !Array.isArray(snapshot.stores) || !snapshot.stores.length) throw new Error('Invalid or unsupported snapshot');
  const names = new Set();
  for (const store of snapshot.stores) {
    if (!store || typeof store.name !== 'string' || names.has(store.name) || !store.schema || !Array.isArray(store.schema.indexes) || !Array.isArray(store.records)) throw new Error('Invalid store schema');
    names.add(store.name);
    const keys = new Set();
    for (const record of store.records) {
      const key = canonical(record.key);
      if (keys.has(key)) throw new Error('Duplicate record key');
      keys.add(key);
      decode(record.key); decode(record.value);
    }
  }
  const { archiveSha256, ...body } = snapshot;
  if (await sha256(canonical(body)) !== archiveSha256) throw new Error('Archive checksum mismatch');
  if (canonical(await buildManifest(snapshot)) !== canonical(snapshot.manifest)) throw new Error('Manifest mismatch');
  return snapshot.manifest;
}

export function inspectRelations(snapshot) {
  const data = Object.fromEntries(snapshot.stores.map(s => [s.name, s.records.map(r => decode(r.value))]));
  const issues = [];
  for (const [child, field, parent] of [['sections', 'notebookId', 'notebooks'], ['pages', 'sectionId', 'sections'], ['strokes', 'pageId', 'pages'], ['shapes', 'pageId', 'pages'], ['textBlocks', 'pageId', 'pages'], ['assets', 'pageId', 'pages']]) {
    const ids = new Set((data[parent] || []).map(r => r.id));
    for (const record of data[child] || []) if (record[field] && !ids.has(record[field])) issues.push({ store: child, id: record.id, field, missingId: record[field] });
  }
  const assets = new Set((data.assets || []).map(a => a.id));
  for (const block of data.textBlocks || []) {
    for (const match of String(block.contentHTML || '').matchAll(/data-asset-id\s*=\s*["']([^"']+)["']/g)) if (!assets.has(match[1])) issues.push({ store: 'textBlocks', id: block.id, missingAsset: match[1] });
  }
  return issues;
}
