import type { IDBPDatabase } from 'idb';
import type { OneNoteDB, ImageAssetRecord } from '../../db/idb';
import type { CloudPullResult, ISyncProvider } from './types';
import type { SyncBinding } from './outboxContext';
import { canonicalContentVersion, contentVersionHash, versionHash, stable, assetIds } from './protocol.mjs';
import { applyCloudPull } from './safePull';
import type { PullRevisions } from './safePull';
import { revisionKey } from './revisionState';
import type { RevisionState } from './revisionState';
import type { OutboxEntity } from './outbox';
import { assetManager } from '../assets/assetManager';
import type { PageElementsBundle } from './compression';

function pageBundles() {
  const pages = new Map<string, PageElementsBundle>();
  return { pages, add(pageId: string, table: keyof PageElementsBundle, row: any) {
    if (!pages.has(pageId)) pages.set(pageId, { strokes: [], shapes: [], textBlocks: [] });
    (pages.get(pageId)![table] as any[]).push(row);
  } };
}

export async function applyVersionedPull(db: IDBPDatabase<OneNoteDB>, cloud: CloudPullResult, provider: ISyncProvider, binding: SyncBinding, protectedPages: Set<string>, isCurrent: () => boolean) {
  const names = ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'] as const;
  const tx = db.transaction([...names, 'syncOutbox'], 'readonly');
  const local = await Promise.all([tx.objectStore('notebooks').getAll(), tx.objectStore('sections').getAll(), tx.objectStore('pages').getAll(), tx.objectStore('strokes').getAll(), tx.objectStore('shapes').getAll(), tx.objectStore('textBlocks').getAll()] as const);
  const stateRows = await tx.objectStore('syncOutbox').getAll(); await tx.done;
  const states = new Map(stateRows.filter((r): r is RevisionState => r.provider === 'state').map(r => [r.key, r]));
  const before = stable(local);
  const localPages = pageBundles(), remotePages = pageBundles();
  for (const [index, table] of ['strokes', 'shapes', 'textBlocks'].entries()) for (const row of local[index + 3]) localPages.add('pageId' in row ? row.pageId : '', table as keyof PageElementsBundle, row);
  const elementTables = { stroke: 'strokes', shape: 'shapes', textBlock: 'textBlocks' } as const;
  for (const row of cloud.elements) if (!row.deletedAt) remotePages.add(row.pageId, elementTables[row.type], row.data);
  const queued = new Set(stateRows.filter(row => row.provider === binding.provider && row.userId === binding.userId).map(row => `${row.entity}:${row.entityId}`));
  const empty: PageElementsBundle = { strokes: [], shapes: [], textBlocks: [] };
  const options: PullRevisions = { binding, accepted: new Set(), protected: new Set(), unchanged: new Set(), bases: [], assets: [], isSnapshotCurrent: rows => stable(rows) === before };
  for (const [index, entity] of ['notebooks', 'sections', 'pages'].entries()) {
    const map = new Map(local[index].map(row => [row.id, row]));
    for (const remote of cloud[entity as OutboxEntity]) {
      const row = map.get(remote.id);
      const localElements = entity === 'pages' ? localPages.pages.get(remote.id) || empty : undefined;
      const remoteElements = entity === 'pages' ? remotePages.pages.get(remote.id) || empty : undefined;
      const actual = await versionHash(entity, row, localElements);
      const incoming = await versionHash(entity, remote, remoteElements);
      const actualContent = await contentVersionHash(entity, row, localElements);
      const incomingContent = await contentVersionHash(entity, remote, remoteElements);
      const sameContent = actualContent === incomingContent;
      const state = states.get(revisionKey(binding, entity as OutboxEntity, remote.id));
      const protectedLocal = queued.has(`${entity}:${remote.id}`) || entity === 'pages' && protectedPages.has(remote.id);
      const bothDeleted = (!row || !!('deletedAt' in row && row.deletedAt)) && !!remote.deletedAt;
      const localChanged = state?.contentBase !== undefined ? state.contentBase !== actualContent : state?.base !== actual;
      let conflict = !bothDeleted && !!row && !sameContent && (protectedLocal || state?.conflict || localChanged);
      if (entity === 'pages' && row && !remote.deletedAt && !sameContent && Object.values(localElements || {}).some(rows => rows.length) && !cloud.completePageIds?.includes(remote.id)) conflict = true;
      // Never bypass a known unsent operation, including metadata-only changes.
      if (protectedLocal && !bothDeleted) options.protected.add(`${entity}:${remote.id}`);
      if (!conflict && (!protectedLocal || bothDeleted)) {
        if (sameContent) options.unchanged.add(`${entity}:${remote.id}`);
        else options.accepted.add(`${entity}:${remote.id}`);
      }
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
      options.bases.push({ entity: entity as OutboxEntity, id: remote.id, hash: incoming, contentHash: incomingContent, canonical: canonicalContentVersion(entity, remote, remoteElements), conflict });
    }
  }
  const result = await applyCloudPull(db, cloud, protectedPages, isCurrent, options);
  if (isCurrent()) for (const asset of options.assets) assetManager.registerAsset(asset.id, asset.blob);
  return result;
}
