/**
 * АРХИТЕКТУРНЫЙ ИНВАРИАНТ (Local-First):
 * Локальное хранилище IndexedDB работает ТОЛЬКО с сырыми объектами JavaScript (structured clone).
 * Здесь НИКОГДА не вызывается compressJson / decompressJson. Это обеспечивает максимальную
 * производительность (60 FPS) и надёжность при работе на холсте.
 */

import { getDB, ImageAssetRecord } from './idb';
import { syncEngine } from '../services/sync/syncEngine';
import { assetManager } from '../services/assets/assetManager';
import { validateLegacyBackup } from './backupValidation';
import { queueLocalChange, OutboxEntity } from '../services/sync/outbox';
import { getSyncBinding } from '../services/sync/outboxContext';
import { Notebook, Section, Page } from '../types/notebook';
import { Stroke, ShapeObject, Camera, CanvasBackground } from '../types/canvas';
import { TextBlock } from '../types/textblock';
import {
  INITIAL_NOTEBOOK,
  INITIAL_SECTIONS,
  INITIAL_PAGES,
} from './initialData';

async function persistEntity(entity: OutboxEntity, value: Notebook | Section | Page, sync = true): Promise<void> {
  const binding = getSyncBinding();
  const db = await getDB();
  const tx = db.transaction([entity, 'syncOutbox'], 'readwrite');
  await tx.objectStore(entity).put(value);
  if (sync) await queueLocalChange(tx, entity, value.id, value.deletedAt ? 'delete' : 'put', binding);
  await tx.done;
}

export async function initStorage(): Promise<void> {
  const db = await getDB();
  const existingNotebooks = await db.getAll('notebooks');
  const otherStores = await Promise.all(['sections', 'pages', 'strokes', 'shapes', 'textBlocks', 'assets'].map(
    name => db.count(name as 'sections' | 'pages' | 'strokes' | 'shapes' | 'textBlocks' | 'assets')
  ));

  // Seed only a genuinely empty database. Legacy IDs are user data, not a reset signal.
  if (existingNotebooks.length === 0 && otherStores.every(count => count === 0)) {
    const tx = db.transaction(
      ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'],
      'readwrite'
    );

    await tx.objectStore('notebooks').put(INITIAL_NOTEBOOK);

    for (const section of INITIAL_SECTIONS) {
      await tx.objectStore('sections').put(section);
    }

    for (const page of INITIAL_PAGES) {
      await tx.objectStore('pages').put(page);
    }

    await tx.done;
  }
}

export async function loadNotebooks(): Promise<Notebook[]> {
  const db = await getDB();
  const notebooks = await db.getAllFromIndex('notebooks', 'by-order');
  return notebooks.filter((nb) => !nb.deletedAt);
}

export async function loadSections(notebookId: string): Promise<Section[]> {
  const db = await getDB();
  const sections = await db.getAllFromIndex('sections', 'by-notebook', notebookId);
  return sections.filter((s) => !s.deletedAt).sort((a, b) => a.order - b.order);
}

export async function loadPages(sectionId: string): Promise<Page[]> {
  const db = await getDB();
  const pages = await db.getAllFromIndex('pages', 'by-section', sectionId);
  return pages.filter((p) => !p.deletedAt).sort((a, b) => a.order - b.order);
}

export async function loadAllPages(): Promise<Page[]> {
  const db = await getDB();
  const pages = await db.getAll('pages');
  return pages.filter((p) => !p.deletedAt);
}

export async function loadPageData(pageId: string): Promise<{
  strokes: Stroke[];
  shapes: ShapeObject[];
  textBlocks: TextBlock[];
}> {
  const db = await getDB();
  const strokes = await db.getAllFromIndex('strokes', 'by-page', pageId);
  const shapes = await db.getAllFromIndex('shapes', 'by-page', pageId);
  const textBlocks = await db.getAllFromIndex('textBlocks', 'by-page', pageId);

  // Предзагрузка медиа-ассетов страницы в память для мгновенного отображения без битых ссылок
  try {
    const assets = await db.getAllFromIndex('assets', 'by-page', pageId);
    for (const asset of assets) {
      assetManager.registerAsset(asset.id, asset.blob);
    }
  } catch {
    // ignore
  }

  return { strokes, shapes, textBlocks };
}

export interface PageDiff {
  strokes?: { put?: Stroke[]; deleteIds?: string[] };
  shapes?: { put?: ShapeObject[]; deleteIds?: string[] };
  textBlocks?: { put?: TextBlock[]; deleteIds?: string[] };
  metadata?: Partial<Pick<Page, 'title' | 'camera' | 'background'>>;
}

/**
 * Атомарное сохранение diff-изменений страницы в рамках одной транзакции IndexedDB.
 * Выполняет точечные put и delete без полного сканирования getAllKeys.
 */
export async function savePageDiff(pageId: string, diff: PageDiff): Promise<void> {
  const binding = getSyncBinding();
  const db = await getDB();
  const tx = db.transaction(['sections', 'pages', 'strokes', 'shapes', 'textBlocks', 'syncOutbox'], 'readwrite');

  if (diff.strokes) {
    const store = tx.objectStore('strokes');
    if (diff.strokes.deleteIds && diff.strokes.deleteIds.length > 0) {
      for (const id of diff.strokes.deleteIds) {
        await store.delete(id);
      }
    }
    if (diff.strokes.put && diff.strokes.put.length > 0) {
      for (const stroke of diff.strokes.put) {
        await store.put(stroke);
      }
    }
  }

  if (diff.shapes) {
    const store = tx.objectStore('shapes');
    if (diff.shapes.deleteIds && diff.shapes.deleteIds.length > 0) {
      for (const id of diff.shapes.deleteIds) {
        await store.delete(id);
      }
    }
    if (diff.shapes.put && diff.shapes.put.length > 0) {
      for (const shape of diff.shapes.put) {
        await store.put(shape);
      }
    }
  }

  if (diff.textBlocks) {
    const store = tx.objectStore('textBlocks');
    if (diff.textBlocks.deleteIds && diff.textBlocks.deleteIds.length > 0) {
      for (const id of diff.textBlocks.deleteIds) {
        await store.delete(id);
      }
    }
    if (diff.textBlocks.put && diff.textBlocks.put.length > 0) {
      for (const block of diff.textBlocks.put) {
        await store.put(block);
      }
    }
  }

  let fullUpdatedPage: Page | null = null;
  if (diff.metadata) {
    const pageStore = tx.objectStore('pages');
    const existing = await pageStore.get(pageId);
    if (existing) {
      fullUpdatedPage = { ...existing, ...diff.metadata };
      if (!fullUpdatedPage.sectionId) {
        const allSecs = await tx.objectStore('sections').getAll();
        fullUpdatedPage.sectionId = allSecs[0]?.id || 'sec-quick-notes';
      }
      await pageStore.put(fullUpdatedPage);
    }
  }

  await queueLocalChange(tx, 'pages', pageId, 'put', binding);
  await tx.done;

  syncEngine.notifyChange({
    pageElements: {
      pageId,
      strokes: diff.strokes?.put,
      shapes: diff.shapes?.put,
      textBlocks: diff.textBlocks?.put,
    },
    pages: fullUpdatedPage ? [fullUpdatedPage] : undefined,
  });
}

/**
 * Полное сохранение состояния страницы в одной атомарной транзакции (для миграций / full sync).
 */
export async function savePageFull(
  pageId: string,
  data: {
    strokes: Stroke[];
    shapes: ShapeObject[];
    textBlocks: TextBlock[];
    camera?: Camera;
    background?: CanvasBackground;
  }
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['pages', 'strokes', 'shapes', 'textBlocks', 'syncOutbox'], 'readwrite');

  const strokeStore = tx.objectStore('strokes');
  const existingStrokes = await strokeStore.index('by-page').getAllKeys(pageId);
  for (const k of existingStrokes) await strokeStore.delete(k);
  for (const s of data.strokes) await strokeStore.put(s);

  const shapeStore = tx.objectStore('shapes');
  const existingShapes = await shapeStore.index('by-page').getAllKeys(pageId);
  for (const k of existingShapes) await shapeStore.delete(k);
  for (const sh of data.shapes) await shapeStore.put(sh);

  const tbStore = tx.objectStore('textBlocks');
  const existingTb = await tbStore.index('by-page').getAllKeys(pageId);
  for (const k of existingTb) await tbStore.delete(k);
  for (const tb of data.textBlocks) await tbStore.put(tb);

  let updatedPage: Page | null = null;
  if (data.camera || data.background) {
    const pageStore = tx.objectStore('pages');
    const page = await pageStore.get(pageId);
    if (page) {
      updatedPage = {
        ...page,
        ...(data.camera ? { camera: data.camera } : {}),
        ...(data.background ? { background: data.background } : {}),
        updatedAt: Date.now(),
      };
      await pageStore.put(updatedPage);
    }
  }

  await queueLocalChange(tx, 'pages', pageId);
  await tx.done;

  syncEngine.notifyChange({
    pageElements: {
      pageId,
      strokes: data.strokes,
      shapes: data.shapes,
      textBlocks: data.textBlocks,
    },
    pages: updatedPage ? [updatedPage] : undefined,
  });
}

export async function savePageStrokes(pageId: string, strokes: Stroke[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['strokes', 'syncOutbox'], 'readwrite');
  const store = tx.objectStore('strokes');

  const existing = await store.index('by-page').getAllKeys(pageId);
  for (const key of existing) {
    await store.delete(key);
  }

  for (const stroke of strokes) {
    await store.put(stroke);
  }

  await queueLocalChange(tx, 'pages', pageId);
  await tx.done;
  syncEngine.notifyChange({ pageElements: { pageId } });
}

export async function savePageShapes(pageId: string, shapes: ShapeObject[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['shapes', 'syncOutbox'], 'readwrite');
  const store = tx.objectStore('shapes');

  const existing = await store.index('by-page').getAllKeys(pageId);
  for (const key of existing) {
    await store.delete(key);
  }

  for (const shape of shapes) {
    await store.put(shape);
  }

  await queueLocalChange(tx, 'pages', pageId);
  await tx.done;
  syncEngine.notifyChange({ pageElements: { pageId } });
}

export async function savePageTextBlocks(pageId: string, textBlocks: TextBlock[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['textBlocks', 'syncOutbox'], 'readwrite');
  const store = tx.objectStore('textBlocks');

  const existing = await store.index('by-page').getAllKeys(pageId);
  for (const key of existing) {
    await store.delete(key);
  }

  for (const block of textBlocks) {
    await store.put(block);
  }

  await queueLocalChange(tx, 'pages', pageId);
  await tx.done;
  syncEngine.notifyChange({ pageElements: { pageId } });
}

export async function updatePageMetadata(
  pageId: string,
  updates: Partial<Pick<Page, 'title' | 'camera' | 'background' | 'slug' | 'slugAliases'>>
): Promise<void> {
  const db = await getDB();
  const page = await db.get('pages', pageId);
  if (page) {
    const updated: Page = { ...page, ...updates };
    if (!updated.sectionId) {
      const allSecs = await db.getAll('sections');
      updated.sectionId = allSecs[0]?.id || 'sec-quick-notes';
    }
    const needsSync = Object.keys(updates).some(key => ['title', 'camera', 'background'].includes(key));
    await persistEntity('pages', updated, needsSync);
    if (needsSync) syncEngine.notifyChange({ pages: [updated] });
  }
}

export async function createNotebook(notebook: Notebook): Promise<void> {
  await persistEntity('notebooks', notebook);
  syncEngine.notifyChange({ notebooks: [notebook] });
}

export async function renameNotebook(notebookId: string, title: string): Promise<void> {
  const db = await getDB();
  const nb = await db.get('notebooks', notebookId);
  if (nb) {
    nb.title = title;
    nb.updatedAt = Date.now();
    await persistEntity('notebooks', nb);
    syncEngine.notifyChange({ notebooks: [nb] });
  }
}

export async function deleteNotebook(notebookId: string): Promise<void> {
  const db = await getDB();
  const now = Date.now();
  const tx = db.transaction(['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks', 'syncOutbox'], 'readwrite');
  const nb = await tx.objectStore('notebooks').get(notebookId);
  if (nb) {
    nb.deletedAt = now;
    nb.updatedAt = now;
    await tx.objectStore('notebooks').put(nb);
  }
  const secs = await tx.objectStore('sections').index('by-notebook').getAll(notebookId);
  const secIds = secs.map((s) => s.id);
  const pageIds: string[] = [];
  for (const s of secs) {
    s.deletedAt = now;
    s.updatedAt = now;
    await tx.objectStore('sections').put(s);
    const pages = await tx.objectStore('pages').index('by-section').getAll(s.id);
    for (const p of pages) {
      p.deletedAt = now;
      p.updatedAt = now;
      pageIds.push(p.id);
      await tx.objectStore('pages').put(p);
    }
  }
  await queueLocalChange(tx, 'notebooks', notebookId, 'delete');
  for (const id of secIds) await queueLocalChange(tx, 'sections', id, 'delete');
  for (const id of pageIds) await queueLocalChange(tx, 'pages', id, 'delete');
  await tx.done;

  syncEngine.notifyDelete({
    notebookIds: [notebookId],
    sectionIds: secIds,
    pageIds,
  });
}

export async function createSection(section: Section): Promise<void> {
  await persistEntity('sections', section);
  syncEngine.notifyChange({ sections: [section] });
}

export async function createPage(page: Page): Promise<void> {
  await persistEntity('pages', page);
  syncEngine.notifyChange({ pages: [page] });
}

export async function deleteSection(sectionId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['sections', 'pages', 'strokes', 'shapes', 'textBlocks', 'syncOutbox'], 'readwrite');

  const pages = await tx.objectStore('pages').index('by-section').getAll(sectionId);
  const pageIds = pages.map((p) => p.id);
  for (const page of pages) {
    await tx.objectStore('pages').delete(page.id);
    const strokeKeys = await tx.objectStore('strokes').index('by-page').getAllKeys(page.id);
    for (const sk of strokeKeys) await tx.objectStore('strokes').delete(sk);
    const shapeKeys = await tx.objectStore('shapes').index('by-page').getAllKeys(page.id);
    for (const shk of shapeKeys) await tx.objectStore('shapes').delete(shk);
    const tbKeys = await tx.objectStore('textBlocks').index('by-page').getAllKeys(page.id);
    for (const tbk of tbKeys) await tx.objectStore('textBlocks').delete(tbk);
  }

  await tx.objectStore('sections').delete(sectionId);
  await queueLocalChange(tx, 'sections', sectionId, 'delete');
  for (const id of pageIds) await queueLocalChange(tx, 'pages', id, 'delete');
  await tx.done;

  syncEngine.notifyDelete({
    sectionIds: [sectionId],
    pageIds,
  });
}

export async function deletePage(pageId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['pages', 'strokes', 'shapes', 'textBlocks', 'syncOutbox'], 'readwrite');

  await tx.objectStore('pages').delete(pageId);
  const strokeKeys = await tx.objectStore('strokes').index('by-page').getAllKeys(pageId);
  for (const sk of strokeKeys) await tx.objectStore('strokes').delete(sk);
  const shapeKeys = await tx.objectStore('shapes').index('by-page').getAllKeys(pageId);
  for (const shk of shapeKeys) await tx.objectStore('shapes').delete(shk);
  const tbKeys = await tx.objectStore('textBlocks').index('by-page').getAllKeys(pageId);
  for (const tbk of tbKeys) await tx.objectStore('textBlocks').delete(tbk);

  await queueLocalChange(tx, 'pages', pageId, 'delete');
  await tx.done;

  syncEngine.notifyDelete({
    pageIds: [pageId],
  });
}

export async function updateSection(
  sectionId: string,
  updates: Partial<Pick<Section, 'title' | 'color' | 'order'>>
): Promise<void> {
  const db = await getDB();
  const sec = await db.get('sections', sectionId);
  if (sec) {
    const updated: Section = { ...sec, ...updates };
    await persistEntity('sections', updated);
    syncEngine.notifyChange({ sections: [updated] });
  }
}

export async function moveToTrashSection(sectionId: string): Promise<void> {
  const db = await getDB();
  const now = Date.now();
  const tx = db.transaction(['sections', 'pages', 'syncOutbox'], 'readwrite');
  const sec = await tx.objectStore('sections').get(sectionId);
  const pages = await tx.objectStore('pages').index('by-section').getAll(sectionId);
  const pageIds: string[] = [];

  if (sec) {
    sec.deletedAt = now;
    await tx.objectStore('sections').put(sec);
  }

  for (const p of pages) {
    p.deletedAt = now;
    pageIds.push(p.id);
    await tx.objectStore('pages').put(p);
  }

  await queueLocalChange(tx, 'sections', sectionId, 'delete');
  for (const id of pageIds) await queueLocalChange(tx, 'pages', id, 'delete');
  await tx.done;

  syncEngine.notifyDelete({
    sectionIds: [sectionId],
    pageIds,
  });
}

export async function restoreSection(sectionId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['sections', 'pages', 'syncOutbox'], 'readwrite');
  const sec = await tx.objectStore('sections').get(sectionId);
  const pages = await tx.objectStore('pages').index('by-section').getAll(sectionId);

  if (sec) {
    delete sec.deletedAt;
    await tx.objectStore('sections').put(sec);
  }

  const restoredPages: Page[] = [];
  for (const p of pages) {
    delete p.deletedAt;
    restoredPages.push(p);
    await tx.objectStore('pages').put(p);
  }

  if (sec) await queueLocalChange(tx, 'sections', sectionId);
  for (const page of restoredPages) await queueLocalChange(tx, 'pages', page.id);
  await tx.done;

  if (sec) {
    syncEngine.notifyChange({
      sections: [sec],
      pages: restoredPages,
    });
  }
}

export async function moveToTrashPage(pageId: string): Promise<void> {
  const db = await getDB();
  const now = Date.now();
  const page = await db.get('pages', pageId);
  if (page) {
    page.deletedAt = now;
    await persistEntity('pages', page);
    syncEngine.notifyDelete({
      pageIds: [pageId],
    });
  }
}

export async function restorePage(pageId: string): Promise<void> {
  const db = await getDB();
  const page = await db.get('pages', pageId);
  if (page) {
    delete page.deletedAt;
    await persistEntity('pages', page);
    syncEngine.notifyChange({
      pages: [page],
    });
  }
}

export async function loadTrash(): Promise<{ sections: Section[]; pages: Page[] }> {
  const db = await getDB();
  const allSections = await db.getAll('sections');
  const allPages = await db.getAll('pages');
  return {
    sections: allSections.filter((s) => !!s.deletedAt),
    pages: allPages.filter((p) => !!p.deletedAt),
  };
}

export interface FullDatabaseBackup {
  version: number;
  exportedAt: number;
  data: {
    notebooks: Notebook[];
    sections: Section[];
    pages: Page[];
    strokes: Stroke[];
    shapes: ShapeObject[];
    textBlocks: TextBlock[];
  };
}

/**
 * Создание полного оффлайн-бэкапа базы данных в формат JSON.
 * Гарантирует сохранение всех заметок и рукописных штрихов даже при сбое облака.
 */
export async function exportFullBackup(): Promise<string> {
  const db = await getDB();
  const tx = db.transaction(['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'], 'readonly');
  const [notebooks, sections, pages, strokes, shapes, textBlocks] = await Promise.all([
    tx.objectStore('notebooks').getAll(), tx.objectStore('sections').getAll(), tx.objectStore('pages').getAll(),
    tx.objectStore('strokes').getAll(), tx.objectStore('shapes').getAll(), tx.objectStore('textBlocks').getAll(),
  ]);
  await tx.done;

  const backup: FullDatabaseBackup = {
    version: 1,
    exportedAt: Date.now(),
    data: {
      notebooks,
      sections,
      pages,
      strokes,
      shapes,
      textBlocks,
    },
  };

  return JSON.stringify(backup, null, 2);
}

/**
 * Восстановление полной базы данных из резервной копии JSON.
 * Атомарно перезаписывает таблицы в рамках одной транзакции IndexedDB.
 */
export async function importFullBackup(backupJson: string): Promise<{ success: boolean; stats: string }> {
  const parsed = JSON.parse(backupJson);
  validateLegacyBackup(parsed);

  const {
    notebooks = [],
    sections = [],
    pages = [],
    strokes = [],
    shapes = [],
    textBlocks = [],
  } = parsed.data;

  const db = await getDB();
  const tx = db.transaction(['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'], 'readwrite');

  await tx.objectStore('notebooks').clear();
  await tx.objectStore('sections').clear();
  await tx.objectStore('pages').clear();
  await tx.objectStore('strokes').clear();
  await tx.objectStore('shapes').clear();
  await tx.objectStore('textBlocks').clear();

  for (const nb of notebooks) await tx.objectStore('notebooks').put(nb);
  for (const sec of sections) await tx.objectStore('sections').put(sec);
  for (const pg of pages) await tx.objectStore('pages').put(pg);
  for (const str of strokes) await tx.objectStore('strokes').put(str);
  for (const sh of shapes) await tx.objectStore('shapes').put(sh);
  for (const tb of textBlocks) await tx.objectStore('textBlocks').put(tb);

  await tx.done;

  return {
    success: true,
    stats: `Восстановлено: ${notebooks.length} блокнотов, ${sections.length} разделов, ${pages.length} страниц, ${strokes.length} штрихов.`,
  };
}

/**
 * Локальное бинарное хранилище изображений (IndexedDB)
 * Хранит сырые оригинальные Blob без компрессии и без base64
 */
export async function saveAssetRecord(asset: ImageAssetRecord): Promise<void> {
  const db = await getDB();
  await db.put('assets', asset);
}

export async function getAssetRecord(id: string): Promise<ImageAssetRecord | undefined> {
  const db = await getDB();
  return db.get('assets', id);
}

export async function getAssetsByPage(pageId: string): Promise<ImageAssetRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('assets', 'by-page', pageId);
}

export async function deleteAssetRecord(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('assets', id);
}


