import type { IDBPDatabase } from 'idb';
import type { OneNoteDB } from '../../db/idb';
import type { CloudPullResult, SyncStats } from './types';
import { validateLegacyBackup } from '../../db/backupValidation';

const stores = ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'] as const;
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateCloudPull(cloud: CloudPullResult): void {
  if (!cloud || !['notebooks', 'sections', 'pages', 'elements'].every(key => Array.isArray(cloud[key as keyof CloudPullResult]))) {
    throw new Error('Неполный ответ облака. Локальные заметки не изменены.');
  }
  for (const rows of [cloud.notebooks, cloud.sections, cloud.pages, cloud.elements]) {
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) || !Number.isFinite(row.updatedAt) || row.updatedAt < 0 || row.deletedAt != null && (!Number.isFinite(row.deletedAt) || row.deletedAt <= 0)) {
        throw new Error('Повреждённый ответ облака. Локальные заметки не изменены.');
      }
      ids.add(row.id);
    }
  }
  for (const element of cloud.elements) {
    if (!['stroke', 'shape', 'textBlock'].includes(element.type) || typeof element.pageId !== 'string' || !element.pageId || !element.deletedAt && (!element.data || element.data.id !== element.id || element.data.pageId !== element.pageId)) {
      throw new Error('Некорректная связь облачного элемента со страницей');
    }
  }
}

/** Incoming rows commit together. Absence never means deletion; existing content is retained on conflict. */
export async function applyCloudPull(db: IDBPDatabase<OneNoteDB>, cloud: CloudPullResult, protectedPageIds: Set<string>, isCurrent: () => boolean = () => true) {
  validateCloudPull(cloud);
  const tx = db.transaction([...stores], 'readwrite');
  // Attach the rejection handler before a request can abort the transaction.
  const done = tx.done; void done.catch(() => {});
  const pulled: SyncStats['pulled'] = { notebooks: 0, sections: 0, pages: 0, elements: 0 };
  const changedPageIds = new Set<string>();
  const conflicts = new Set<string>();
  try {
    const local = await Promise.all(stores.map(name => tx.objectStore(name).getAll()));
    const checkCurrent = () => { if (!isCurrent()) throw new Error('Во время синхронизации появились новые правки или изменился аккаунт. Локальная загрузка отменена; повторите синхронизацию.'); };
    checkCurrent();
    const maps = Object.fromEntries(stores.map((name, i) => [name, new Map(local[i].map(row => [row.id, row]))])) as Record<typeof stores[number], Map<string, any>>;
    const merged = (name: 'notebooks' | 'sections' | 'pages', remote: any[]) => {
      const rows = new Map(maps[name]);
      for (const row of remote) rows.set(row.id, { ...rows.get(row.id), ...row });
      return [...rows.values()];
    };
    // Validate incoming records and their relations against the local + remote hierarchy.
    // Local objects are read, never normalized or guessed here.
    const allPages = merged('pages', cloud.pages);
    const incoming = { notebooks: merged('notebooks', cloud.notebooks), sections: merged('sections', cloud.sections), pages: allPages,
      strokes: cloud.elements.filter(el => el.type === 'stroke' && !el.deletedAt).map(el => el.data),
      shapes: cloud.elements.filter(el => el.type === 'shape' && !el.deletedAt).map(el => el.data),
      textBlocks: cloud.elements.filter(el => el.type === 'textBlock' && !el.deletedAt).map(el => el.data) };
    validateLegacyBackup({ version: 1, data: incoming });

    const localContent = new Map<string, Map<string, any>>();
    for (const name of ['strokes', 'shapes', 'textBlocks'] as const) for (const row of maps[name].values()) {
      if (!localContent.has(row.pageId)) localContent.set(row.pageId, new Map());
      localContent.get(row.pageId)!.set(`${name}:${row.id}`, row);
    }
    const remoteContent = new Map<string, Map<string, any>>();
    const tableFor = { stroke: 'strokes', shape: 'shapes', textBlock: 'textBlocks' } as const;
    for (const el of cloud.elements) if (!el.deletedAt) {
      if (!remoteContent.has(el.pageId)) remoteContent.set(el.pageId, new Map());
      remoteContent.get(el.pageId)!.set(`${tableFor[el.type]}:${el.id}`, el.data);
    }
    // Without a shared base revision, a differing populated page must not be overlaid or replaced.
    for (const [pageId, remote] of remoteContent) {
      if (protectedPageIds.has(pageId)) continue;
      const existing = localContent.get(pageId);
      if (existing?.size && (existing.size !== remote.size || [...remote].some(([id, data]) => !existing.has(id) || stable(existing.get(id)) !== stable(data)))) {
        protectedPageIds.add(pageId); conflicts.add(pageId);
      }
    }
    const protectedSections = new Set<string>();
    const protectedNotebooks = new Set<string>();
    for (const page of cloud.pages) if (page.deletedAt && localContent.get(page.id)?.size) {
      protectedPageIds.add(page.id); conflicts.add(page.id);
    }
    for (const section of cloud.sections) if (section.deletedAt) {
      for (const page of maps.pages.values()) if (page.sectionId === section.id && localContent.get(page.id)?.size) {
        protectedSections.add(section.id); protectedPageIds.add(page.id); conflicts.add(page.id);
      }
    }
    for (const notebook of cloud.notebooks) if (notebook.deletedAt) {
      for (const section of maps.sections.values()) if (section.notebookId === notebook.id) {
        for (const page of maps.pages.values()) if (page.sectionId === section.id && localContent.get(page.id)?.size) {
          protectedNotebooks.add(notebook.id); protectedSections.add(section.id); protectedPageIds.add(page.id); conflicts.add(page.id);
        }
      }
    }
    for (const pageId of protectedPageIds) {
      const page = maps.pages.get(pageId);
      if (!page) continue;
      protectedSections.add(page.sectionId);
      const section = maps.sections.get(page.sectionId);
      if (section) protectedNotebooks.add(section.notebookId);
    }
    for (const [name, remote] of [['notebooks', cloud.notebooks], ['sections', cloud.sections], ['pages', cloud.pages]] as const) {
      for (const row of remote) {
        const previous = maps[name].get(row.id);
        if (name === 'sections' && 'notebookId' in row && (!maps.notebooks.has(row.notebookId) || maps.notebooks.get(row.notebookId)?.deletedAt)) continue;
        if (name === 'pages' && 'sectionId' in row && (!maps.sections.has(row.sectionId) || maps.sections.get(row.sectionId)?.deletedAt)) continue;
        if (name === 'pages' && protectedPageIds.has(row.id)) continue;
        if (row.deletedAt && (name === 'sections' && protectedSections.has(row.id) || name === 'notebooks' && protectedNotebooks.has(row.id))) continue;
        if (previous && row.updatedAt <= Math.max(previous.updatedAt || 0, previous.deletedAt || 0)) continue;
        // Keep recoverable tombstones instead of physically deleting local metadata.
        if (row.deletedAt && !previous) continue;
        const next = { ...previous, ...row };
        await tx.objectStore(name).put(next);
        checkCurrent();
        maps[name].set(row.id, next);
        pulled[name]++;
        if (name === 'pages') changedPageIds.add(row.id);
      }
    }
    for (const el of cloud.elements) {
      if (protectedPageIds.has(el.pageId) || !maps.pages.has(el.pageId) || maps.pages.get(el.pageId)?.deletedAt) continue;
      const name = tableFor[el.type];
      const previous = maps[name].get(el.id);
      // Individual tombstones remain in the cloud until a revision-aware protocol can apply them safely.
      if (el.deletedAt) continue;
      if (previous && stable(previous) === stable(el.data)) continue;
      if (previous) { conflicts.add(el.pageId); continue; }
      await tx.objectStore(name).put(el.data);
      checkCurrent();
      pulled.elements++; changedPageIds.add(el.pageId);
    }
    checkCurrent();
    await done;
    return { pulled, changedPageIds, conflicts };
  } catch (error) {
    try { tx.abort(); } catch { /* Already aborted. */ }
    await done.catch(() => {});
    throw error;
  }
}
