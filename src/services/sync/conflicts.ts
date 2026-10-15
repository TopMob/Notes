import type { IDBPDatabase } from 'idb';
import type { OneNoteDB, ImageAssetRecord } from '../../db/idb';
import type { OutboxEntry, OutboxEntity } from './outbox';
import { queueLocalChange } from './outbox';
import { putRevision, revisionKey } from './revisionState';
import type { RevisionState } from './revisionState';
import type { SyncBinding } from './outboxContext';
import type { ISyncProvider } from './types';
import { validateCloudPull } from './safePull';
import { cloudElementsFor, canonicalVersion, canonicalContentVersion, contentVersionHash, versionHash, assetIds } from './protocol.mjs';
import { assetManager } from '../assets/assetManager';

export interface ConflictSummary { entity: OutboxEntity; id: string; localTitle: string; cloudTitle: string; localCount: number; cloudCount: number }
async function localSnapshot(db: IDBPDatabase<OneNoteDB>, entity: OutboxEntity, id: string) {
  const tx = db.transaction([entity, 'strokes', 'shapes', 'textBlocks'], 'readonly');
  const record = await tx.objectStore(entity).get(id);
  const elements = { strokes: await tx.objectStore('strokes').index('by-page').getAll(id), shapes: await tx.objectStore('shapes').index('by-page').getAll(id), textBlocks: await tx.objectStore('textBlocks').index('by-page').getAll(id) };
  await tx.done; return { record, elements };
}
export async function listConflicts(db: IDBPDatabase<OneNoteDB>, binding: SyncBinding, provider: ISyncProvider): Promise<ConflictSummary[]> {
  const states = (await db.getAll('syncOutbox')).filter((row): row is RevisionState => row.provider === 'state' && row.bindingProvider === binding.provider && row.userId === binding.userId && !!row.conflict);
  if (!states.length) return [];
  const cloud = await provider.pullAll(binding.userId!); validateCloudPull(cloud);
  const result: ConflictSummary[] = [];
  for (const state of states) {
    const local = await localSnapshot(db, state.entity, state.entityId);
    const remote = cloud[state.entity].find(row => row.id === state.entityId);
    const elements = cloudElementsFor(cloud, state.entityId);
    const count = (elements: typeof local.elements) => elements.strokes.length + elements.shapes.length + elements.textBlocks.length;
    const isLocalDeleted = local.record ? !!local.record.deletedAt : state.entity !== 'pages' || count(local.elements) === 0;
    const isRemoteDeleted = remote ? !!remote.deletedAt : state.entity !== 'pages' || count(elements) === 0;
    const sameContent = canonicalContentVersion(state.entity, local.record, local.elements) === canonicalContentVersion(state.entity, remote, elements);
    if (isLocalDeleted && isRemoteDeleted || sameContent) {
      const remoteHash = await versionHash(state.entity, remote, elements);
      const contentHash = await contentVersionHash(state.entity, remote, elements);
      const tx = db.transaction([state.entity, 'strokes', 'shapes', 'textBlocks', 'syncOutbox'], 'readwrite');
      const nowRecord = await tx.objectStore(state.entity).get(state.entityId);
      const nowElements = { strokes: await tx.objectStore('strokes').index('by-page').getAll(state.entityId), shapes: await tx.objectStore('shapes').index('by-page').getAll(state.entityId), textBlocks: await tx.objectStore('textBlocks').index('by-page').getAll(state.entityId) };
      const row = await tx.objectStore('syncOutbox').get(revisionKey(binding, state.entity, state.entityId)) as RevisionState | undefined;
      const unchanged = canonicalVersion(state.entity, nowRecord, nowElements) === canonicalVersion(state.entity, local.record, local.elements);
      if (row?.conflict && unchanged) {
        await putRevision(tx, binding, state.entity, state.entityId, remoteHash, false, contentHash);
      }
      await tx.done;
      if (unchanged) continue;
    }
    result.push({ entity: state.entity, id: state.entityId, localTitle: !local.record || local.record.deletedAt ? 'Удалено на этом устройстве' : local.record.title, cloudTitle: !remote ? count(elements) ? 'Содержимое без метаданных страницы' : 'Удалено в облаке' : remote.deletedAt ? 'Удалено в облаке' : remote.title, localCount: count(local.elements), cloudCount: count(elements) });
  }
  return result;
}

// Choosing a working version archives the other page under a deterministic ID, never overlays it.
export async function resolveConflict(db: IDBPDatabase<OneNoteDB>, binding: SyncBinding, provider: ISyncProvider, entity: OutboxEntity, id: string, choice: 'local' | 'cloud', isCurrent: () => boolean) {
  const local = await localSnapshot(db, entity, id);
  const cloud = await provider.pullAll(binding.userId!); validateCloudPull(cloud);
  const remote = cloud[entity].find(row => row.id === id);
  const remoteElements = cloudElementsFor(cloud, id);
  const remoteHash = await versionHash(entity, remote, remoteElements);
  const orphan = entity === 'pages' && !remote && remoteHash !== null;
  if (orphan && !local.record) throw new Error('Для содержимого без метаданных нет локальной структуры. Сначала восстановите страницу из копии.');
  const remoteVersion = orphan ? local.record && { ...local.record, deletedAt: null, title: 'Восстановленная облачная версия' } : remote;
  const localHash = await versionHash(entity, local.record, local.elements);
  const localCanonical = canonicalVersion(entity, local.record, local.elements);
  const queueKey = JSON.stringify([binding.provider, binding.userId, entity, id]);
  const queuedBefore = await db.get('syncOutbox', queueKey) as OutboxEntry | undefined;
  const isDeletedLocal = local.record ? !!local.record.deletedAt : localHash === null;
  const isDeletedRemote = remote ? !!remote.deletedAt : remoteHash === null;

  if (isDeletedLocal && isDeletedRemote) {
    const tx = db.transaction([entity, 'strokes', 'shapes', 'textBlocks', 'syncOutbox'], 'readwrite');
    void tx.done.catch(() => {});
    await tx.objectStore('syncOutbox').delete(queueKey);
    await putRevision(tx, binding, entity, id, remoteHash);
    if (entity === 'pages') {
      const nowElements = { strokes: await tx.objectStore('strokes').index('by-page').getAll(id), shapes: await tx.objectStore('shapes').index('by-page').getAll(id), textBlocks: await tx.objectStore('textBlocks').index('by-page').getAll(id) };
      for (const name of ['strokes', 'shapes', 'textBlocks'] as const) {
        for (const row of nowElements[name]) await tx.objectStore(name).delete(row.id);
      }
    }
    await tx.done;
    return;
  }

  const other = choice === 'local' ? remoteVersion : local.record;
  const otherElements = choice === 'local' ? remoteElements : local.elements;
  const otherHash = choice === 'local' ? remoteHash : localHash;
  const assets: ImageAssetRecord[] = [];
  if (entity === 'pages' && provider.downloadAsset) for (const assetId of assetIds(remoteElements)) if (!await db.get('assets', assetId)) {
    const blob = await provider.downloadAsset(assetId);
    assets.push({ id: assetId, pageId: id, blob, mimeType: blob.type, createdAt: Date.now() });
  }
  if (!isCurrent()) throw new Error('Во время выбора версии появились правки или сменился аккаунт. Повторите выбор.');
  const tx = db.transaction(['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks', 'assets', 'syncOutbox'], 'readwrite');
  void tx.done.catch(() => {});
  try {
    const nowRecord = await tx.objectStore(entity).get(id);
    const nowElements = { strokes: await tx.objectStore('strokes').index('by-page').getAll(id), shapes: await tx.objectStore('shapes').index('by-page').getAll(id), textBlocks: await tx.objectStore('textBlocks').index('by-page').getAll(id) };
    const nowQueued = await tx.objectStore('syncOutbox').get(queueKey) as OutboxEntry | undefined;
    if (canonicalVersion(entity, nowRecord, nowElements) !== localCanonical || nowQueued?.operationId !== queuedBefore?.operationId || !isCurrent()) throw new Error('Заметка изменилась в другой вкладке. Повторите выбор.');
    for (const asset of assets) await tx.objectStore('assets').put(asset);
    if (entity === 'pages' && other && otherHash && localHash !== remoteHash && !other.deletedAt) {
      const archiveId = `conflict_${id}_${otherHash.slice(0, 20)}`;
      if (!await tx.objectStore('pages').get(archiveId)) {
        const sectionId = local.record && 'sectionId' in local.record ? local.record.sectionId : remote && 'sectionId' in remote ? remote.sectionId : '';
        const section = sectionId ? await tx.objectStore('sections').get(sectionId) : null;
        if (section && !section.deletedAt) {
          const pageVersion = other as OneNoteDB['pages']['value'];
          await tx.objectStore('pages').put({ ...pageVersion, id: archiveId, sectionId, title: `${pageVersion.title} (${choice === 'local' ? 'облачная' : 'локальная'} версия)`, createdAt: Date.now(), deletedAt: null, order: other.order, slug: `conflict-${otherHash.slice(0, 20)}`, slugAliases: [] });
          for (const name of ['strokes', 'shapes', 'textBlocks'] as const) for (const row of otherElements[name]) await tx.objectStore(name).put({ ...row, id: `conflict_${row.id}_${otherHash.slice(0, 20)}`, pageId: archiveId });
          await queueLocalChange(tx, 'pages', archiveId, 'put', binding);
        }
      }
    }
    const previousState = await tx.objectStore('syncOutbox').get(revisionKey(binding, entity, id)) as RevisionState | undefined;
    await putRevision(tx, binding, entity, id, remoteHash);
    if (entity !== 'pages' && other) await tx.objectStore('syncOutbox').put({ ...(await tx.objectStore('syncOutbox').get(revisionKey(binding, entity, id))) as RevisionState, alternatives: [...(previousState?.alternatives || []).filter(row => row.hash !== otherHash), { hash: otherHash, record: other }] });
    if (choice === 'cloud') {
      await tx.objectStore('syncOutbox').delete(queueKey);
      if (remoteVersion) await tx.objectStore(entity).put({ ...local.record, ...remoteVersion } as any);
      else if (local.record) await tx.objectStore(entity).put({ ...local.record, deletedAt: Date.now() } as any);
      if (entity === 'pages') {
        for (const name of ['strokes', 'shapes', 'textBlocks'] as const) {
          for (const row of nowElements[name]) await tx.objectStore(name).delete(row.id);
          if (!remoteVersion?.deletedAt) {
            for (const row of remoteElements[name]) await tx.objectStore(name).put(row);
          }
        }
      }
      if (orphan) {
        await queueLocalChange(tx, entity, id, 'put', binding);
        const queued = await tx.objectStore('syncOutbox').get(queueKey) as OutboxEntry;
        await tx.objectStore('syncOutbox').put({ ...queued, base: remoteHash });
      }
    } else {
      if (entity === 'pages' && isDeletedLocal) {
        for (const name of ['strokes', 'shapes', 'textBlocks'] as const) {
          for (const row of nowElements[name]) await tx.objectStore(name).delete(row.id);
        }
      }
      await queueLocalChange(tx, entity, id, !local.record || local.record.deletedAt ? 'delete' : 'put', binding);
      const queued = await tx.objectStore('syncOutbox').get(queueKey) as OutboxEntry;
      await tx.objectStore('syncOutbox').put({ ...queued, base: remoteHash });
    }
    if (!isCurrent()) throw new Error('Появились новые правки; выбор версии отменён');
    await tx.done;
    if (isCurrent()) for (const asset of assets) assetManager.registerAsset(asset.id, asset.blob);
  } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
}
