import type { IDBPDatabase } from 'idb';
import type { OneNoteDB, ImageAssetRecord } from '../../db/idb';
import type { OutboxEntry, OutboxEntity } from './outbox';
import { queueLocalChange } from './outbox';
import { putRevision, revisionKey } from './revisionState';
import type { RevisionState } from './revisionState';
import type { SyncBinding } from './outboxContext';
import type { ISyncProvider } from './types';
import { validateCloudPull } from './safePull';
import { cloudElementsFor, canonicalVersion, versionHash, assetIds } from './protocol.mjs';

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
    if (entity === 'pages' && other && otherHash && localHash !== remoteHash) {
      const archiveId = `conflict_${id}_${otherHash.slice(0, 20)}`;
      if (!await tx.objectStore('pages').get(archiveId)) {
        const sectionId = local.record && 'sectionId' in local.record ? local.record.sectionId : remote && 'sectionId' in remote ? remote.sectionId : '';
        const section = await tx.objectStore('sections').get(sectionId);
        if (!section) throw new Error('Раздел версии отсутствует локально. Сначала разрешите конфликт раздела.');
        const pageVersion = other as OneNoteDB['pages']['value'];
        await tx.objectStore('pages').put({ ...pageVersion, id: archiveId, sectionId, title: `${pageVersion.title} (${choice === 'local' ? 'облачная' : 'локальная'} версия)`, createdAt: Date.now(), deletedAt: null, order: other.order, slug: `conflict-${otherHash.slice(0, 20)}`, slugAliases: [] });
        for (const name of ['strokes', 'shapes', 'textBlocks'] as const) for (const row of otherElements[name]) await tx.objectStore(name).put({ ...row, id: `conflict_${row.id}_${otherHash.slice(0, 20)}`, pageId: archiveId });
        if (!section.deletedAt) await queueLocalChange(tx, 'pages', archiveId, 'put', binding);
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
          for (const row of remoteElements[name]) await tx.objectStore(name).put(row);
        }
      }
      if (orphan) {
        await queueLocalChange(tx, entity, id, 'put', binding);
        const queued = await tx.objectStore('syncOutbox').get(queueKey) as OutboxEntry;
        await tx.objectStore('syncOutbox').put({ ...queued, base: remoteHash });
      }
    } else {
      await queueLocalChange(tx, entity, id, !local.record || local.record.deletedAt ? 'delete' : 'put', binding);
      const queued = await tx.objectStore('syncOutbox').get(queueKey) as OutboxEntry;
      await tx.objectStore('syncOutbox').put({ ...queued, base: remoteHash });
    }
    if (!isCurrent()) throw new Error('Появились новые правки; выбор версии отменён');
    await tx.done;
  } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
}
