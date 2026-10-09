import { getDB } from '../../db/idb';
import type { OneNoteDB } from '../../db/idb';
import type { IDBPTransaction } from 'idb';
import { getSyncBinding } from './outboxContext';
import type { SyncBinding } from './outboxContext';

export type OutboxEntity = 'notebooks' | 'sections' | 'pages';
export const outboxSessionId = crypto.randomUUID();
export interface OutboxEntry extends SyncBinding {
  key: string;
  entity: OutboxEntity;
  entityId: string;
  action: 'put' | 'delete';
  operationId: string;
  sessionId: string;
  createdAt: number;
}
type WriteTransaction = IDBPTransaction<OneNoteDB, any, 'readwrite'>;

export async function queueLocalChange(tx: WriteTransaction, entity: OutboxEntity, entityId: string, action: OutboxEntry['action'] = 'put', binding = getSyncBinding()): Promise<void> {
  if (!binding) return;
  void tx.done.catch(() => {});
  try {
    const key = JSON.stringify([binding.provider, binding.userId, entity, entityId]);
    await tx.objectStore('syncOutbox').put({ ...binding, key, entity, entityId, action, operationId: crypto.randomUUID(), sessionId: outboxSessionId, createdAt: Date.now() });
  } catch (error) {
    try { tx.abort(); } catch { /* Already aborted. */ }
    throw error;
  }
}

export async function pendingOutbox(binding: SyncBinding): Promise<OutboxEntry[]> {
  const db = await getDB();
  const all = await db.getAll('syncOutbox');
  return all.filter(row => row.provider === binding.provider && row.userId === binding.userId);
}

export async function acknowledgeOutbox(entry: OutboxEntry): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('syncOutbox', 'readwrite');
  const current = await tx.store.get(entry.key);
  if (current?.operationId === entry.operationId) await tx.store.delete(entry.key);
  await tx.done;
}

// Metadata, elements and intent are read from one consistent local snapshot.
export async function readOutboxSnapshot(entry: OutboxEntry) {
  const db = await getDB();
  const tx = db.transaction(['syncOutbox', 'notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'], 'readonly');
  const current = await tx.objectStore('syncOutbox').get(entry.key);
  if (!current || current.operationId !== entry.operationId) { await tx.done; return null; }
  const record = await tx.objectStore(entry.entity).get(entry.entityId);
  const page = entry.entity === 'pages' ? record as OneNoteDB['pages']['value'] | undefined : undefined;
  const section = entry.entity === 'sections' ? record as OneNoteDB['sections']['value'] | undefined : page ? await tx.objectStore('sections').get(page.sectionId) : undefined;
  const notebook = entry.entity === 'notebooks' ? record as OneNoteDB['notebooks']['value'] | undefined : section ? await tx.objectStore('notebooks').get(section.notebookId) : undefined;
  const elements = page && entry.action === 'put' && !page.deletedAt ? {
    strokes: await tx.objectStore('strokes').index('by-page').getAll(page.id),
    shapes: await tx.objectStore('shapes').index('by-page').getAll(page.id),
    textBlocks: await tx.objectStore('textBlocks').index('by-page').getAll(page.id),
  } : null;
  await tx.done;
  return { entry: current, record, page, section, notebook, elements };
}

// Explicit UI action only: anonymous drafts are never silently assigned to an account.
export async function claimUnownedOutbox(binding: SyncBinding): Promise<void> {
  if (!binding.userId) return;
  const db = await getDB();
  const tx = db.transaction('syncOutbox', 'readwrite');
  for (const entry of await tx.store.getAll()) {
    if (entry.provider !== binding.provider || entry.userId !== null) continue;
    const key = JSON.stringify([binding.provider, binding.userId, entry.entity, entry.entityId]);
    await tx.store.put({ ...entry, ...binding, key, operationId: crypto.randomUUID() });
    await tx.store.delete(entry.key);
  }
  await tx.done;
}
