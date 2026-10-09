import type { IDBPDatabase } from 'idb';
import type { OneNoteDB, ImageAssetRecord } from '../../db/idb';
import type { CloudPullResult, ISyncProvider } from './types';
import type { SyncBinding } from './outboxContext';
import { canonicalVersion, cloudElementsFor, versionHash, stable, assetIds } from './protocol.mjs';
import { applyCloudPull } from './safePull';
import type { PullRevisions } from './safePull';
import { revisionKey } from './revisionState';
import type { RevisionState } from './revisionState';
import type { OutboxEntity } from './outbox';

export async function applyVersionedPull(db: IDBPDatabase<OneNoteDB>, cloud: CloudPullResult, provider: ISyncProvider, binding: SyncBinding, protectedPages: Set<string>, isCurrent: () => boolean) {
  const names = ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'] as const;
  const tx = db.transaction([...names, 'syncOutbox'], 'readonly');
  const local = await Promise.all([tx.objectStore('notebooks').getAll(), tx.objectStore('sections').getAll(), tx.objectStore('pages').getAll(), tx.objectStore('strokes').getAll(), tx.objectStore('shapes').getAll(), tx.objectStore('textBlocks').getAll()] as const);
  const stateRows = await tx.objectStore('syncOutbox').getAll(); await tx.done;
  const states = new Map(stateRows.filter((r): r is RevisionState => r.provider === 'state').map(r => [r.key, r]));
  const before = stable(local);
  const options: PullRevisions = { binding, accepted: new Set(), protected: new Set(), bases: [], assets: [], isSnapshotCurrent: rows => stable(rows) === before };
  for (const [index, entity] of ['notebooks', 'sections', 'pages'].entries()) {
    const map = new Map(local[index].map(row => [row.id, row]));
    for (const remote of cloud[entity as OutboxEntity]) {
      const row = map.get(remote.id);
      const localElements = entity === 'pages' ? { strokes: local[3].filter(r => r.pageId === remote.id), shapes: local[4].filter(r => r.pageId === remote.id), textBlocks: local[5].filter(r => r.pageId === remote.id) } : undefined;
      const remoteElements = entity === 'pages' ? cloudElementsFor(cloud, remote.id) : undefined;
      const actual = await versionHash(entity, row, localElements);
      const incoming = await versionHash(entity, remote, remoteElements);
      const state = states.get(revisionKey(binding, entity as OutboxEntity, remote.id));
      const protectedLocal = stateRows.some(r => r.provider === binding.provider && r.userId === binding.userId && r.entity === entity && r.entityId === remote.id) || entity === 'pages' && protectedPages.has(remote.id);
      let conflict = !!row && actual !== incoming && (protectedLocal || state?.conflict || state?.base !== actual);
      if (entity === 'pages' && row && !remote.deletedAt && actual !== incoming && Object.values(localElements || {}).some(rows => rows.length) && !cloud.completePageIds?.includes(remote.id)) conflict = true;
      // Never bypass a known unsent operation, including metadata-only changes.
      if (protectedLocal) options.protected.add(`${entity}:${remote.id}`);
      if (!conflict && !protectedLocal) options.accepted.add(`${entity}:${remote.id}`);
      if (entity === 'pages' && !conflict && !protectedLocal && !remote.deletedAt && provider.downloadAsset) {
        for (const id of assetIds(remoteElements || {})) if (!await db.get('assets', id) && !options.assets.some(asset => asset.id === id)) {
          try {
            const blob = await provider.downloadAsset(id);
            options.assets.push({ id, pageId: remote.id, blob, mimeType: blob.type, createdAt: Date.now() } as ImageAssetRecord);
          } catch {
            conflict = true; options.accepted.delete(`pages:${remote.id}`); break;
          }
        }
      }
      if (conflict) { options.protected.add(`${entity}:${remote.id}`); if (entity === 'pages') protectedPages.add(remote.id); }
      options.bases.push({ entity: entity as OutboxEntity, id: remote.id, hash: incoming, canonical: canonicalVersion(entity, remote, remoteElements), conflict });
    }
  }
  return applyCloudPull(db, cloud, protectedPages, isCurrent, options);
}
