import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { OneNoteDB } from '../../db/idb';
import type { OutboxEntity, OutboxEntry } from './outbox';
import type { SyncBinding } from './outboxContext';
import type { PageElementsBundle } from './compression';

export interface GuardedOperation { entity: OutboxEntity; id: string; action: 'put' | 'delete'; expected: string | null; record?: any; elements?: PageElementsBundle }
export interface RevisionState {
  key: string;
  provider: 'state';
  bindingProvider: SyncBinding['provider'];
  userId: string | null;
  entity: OutboxEntity;
  entityId: string;
  base: string | null;
  conflict?: boolean;
  alternatives?: { hash: string | null; record: any }[];
}
export function revisionKey(binding: SyncBinding, entity: OutboxEntity, id: string) { return JSON.stringify(['state', binding.provider, binding.userId, entity, id]); }
export async function getRevision(db: IDBPDatabase<OneNoteDB>, binding: SyncBinding, entity: OutboxEntity, id: string): Promise<RevisionState | undefined> {
  return await db.get('syncOutbox', revisionKey(binding, entity, id)) as RevisionState | undefined;
}
export async function putRevision(tx: IDBPTransaction<OneNoteDB, any, 'readwrite'>, binding: SyncBinding, entity: OutboxEntity, id: string, base: string | null, conflict = false) {
  const key = revisionKey(binding, entity, id);
  const previous = await tx.objectStore('syncOutbox').get(key) as RevisionState | undefined;
  await tx.objectStore('syncOutbox').put({ ...previous, key, provider: 'state', bindingProvider: binding.provider, userId: binding.userId, entity, entityId: id, base, conflict });
}
export async function flagConflict(db: IDBPDatabase<OneNoteDB>, entry: OutboxEntry) {
  const tx = db.transaction('syncOutbox', 'readwrite');
  const previous = await tx.store.get(revisionKey(entry, entry.entity, entry.entityId)) as RevisionState | undefined;
  await putRevision(tx, entry, entry.entity, entry.entityId, previous?.base ?? entry.base ?? null, true);
  await tx.done;
}
