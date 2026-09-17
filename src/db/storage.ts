import { getDB } from './idb';
import { syncEngine } from '../services/sync/syncEngine';
import { Notebook, Section, Page } from '../types/notebook';
import { Stroke, ShapeObject, Camera, CanvasBackground } from '../types/canvas';
import { TextBlock } from '../types/textblock';
import {
  INITIAL_NOTEBOOK,
  INITIAL_SECTIONS,
  INITIAL_PAGES,
} from './initialData';

export async function initStorage(): Promise<void> {
  const db = await getDB();
  const existingNotebooks = await db.getAll('notebooks');
  const hasOldTestData = existingNotebooks.some((nb) => nb.id === 'nb-college');

  if (existingNotebooks.length === 0 || hasOldTestData) {
    const tx = db.transaction(
      ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'],
      'readwrite'
    );

    if (hasOldTestData) {
      await tx.objectStore('notebooks').clear();
      await tx.objectStore('sections').clear();
      await tx.objectStore('pages').clear();
      await tx.objectStore('strokes').clear();
      await tx.objectStore('shapes').clear();
      await tx.objectStore('textBlocks').clear();
    }

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
  return db.getAllFromIndex('notebooks', 'by-order');
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

export async function loadPageData(pageId: string): Promise<{
  strokes: Stroke[];
  shapes: ShapeObject[];
  textBlocks: TextBlock[];
}> {
  const db = await getDB();
  const strokes = await db.getAllFromIndex('strokes', 'by-page', pageId);
  const shapes = await db.getAllFromIndex('shapes', 'by-page', pageId);
  const textBlocks = await db.getAllFromIndex('textBlocks', 'by-page', pageId);

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
  const db = await getDB();
  const tx = db.transaction(['pages', 'strokes', 'shapes', 'textBlocks'], 'readwrite');

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

  if (diff.metadata) {
    const pageStore = tx.objectStore('pages');
    const page = await pageStore.get(pageId);
    if (page) {
      await pageStore.put({ ...page, ...diff.metadata });
    }
  }

  await tx.done;

  syncEngine.notifyChange({
    pageElements: {
      pageId,
      strokes: diff.strokes?.put,
      shapes: diff.shapes?.put,
      textBlocks: diff.textBlocks?.put,
    },
    pages: diff.metadata ? [{ id: pageId, ...diff.metadata } as any] : undefined,
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
  const tx = db.transaction(['pages', 'strokes', 'shapes', 'textBlocks'], 'readwrite');

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

  if (data.camera || data.background) {
    const pageStore = tx.objectStore('pages');
    const page = await pageStore.get(pageId);
    if (page) {
      await pageStore.put({
        ...page,
        ...(data.camera ? { camera: data.camera } : {}),
        ...(data.background ? { background: data.background } : {}),
      });
    }
  }

  await tx.done;
}

export async function savePageStrokes(pageId: string, strokes: Stroke[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('strokes', 'readwrite');
  const store = tx.objectStore('strokes');

  const existing = await store.index('by-page').getAllKeys(pageId);
  for (const key of existing) {
    await store.delete(key);
  }

  for (const stroke of strokes) {
    await store.put(stroke);
  }

  await tx.done;
}

export async function savePageShapes(pageId: string, shapes: ShapeObject[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('shapes', 'readwrite');
  const store = tx.objectStore('shapes');

  const existing = await store.index('by-page').getAllKeys(pageId);
  for (const key of existing) {
    await store.delete(key);
  }

  for (const shape of shapes) {
    await store.put(shape);
  }

  await tx.done;
}

export async function savePageTextBlocks(pageId: string, textBlocks: TextBlock[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('textBlocks', 'readwrite');
  const store = tx.objectStore('textBlocks');

  const existing = await store.index('by-page').getAllKeys(pageId);
  for (const key of existing) {
    await store.delete(key);
  }

  for (const block of textBlocks) {
    await store.put(block);
  }

  await tx.done;
}

export async function updatePageMetadata(
  pageId: string,
  updates: Partial<Pick<Page, 'title' | 'camera' | 'background'>>
): Promise<void> {
  const db = await getDB();
  const page = await db.get('pages', pageId);
  if (page) {
    const updated: Page = { ...page, ...updates };
    await db.put('pages', updated);
    syncEngine.notifyChange({ pages: [updated] });
  }
}

export async function createSection(section: Section): Promise<void> {
  const db = await getDB();
  await db.put('sections', section);
  syncEngine.notifyChange({ sections: [section] });
}

export async function createPage(page: Page): Promise<void> {
  const db = await getDB();
  await db.put('pages', page);
  syncEngine.notifyChange({ pages: [page] });
}

export async function deleteSection(sectionId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['sections', 'pages', 'strokes', 'shapes', 'textBlocks'], 'readwrite');

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
  await tx.done;

  syncEngine.notifyDelete({
    sectionIds: [sectionId],
    pageIds,
  });
}

export async function deletePage(pageId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['pages', 'strokes', 'shapes', 'textBlocks'], 'readwrite');

  await tx.objectStore('pages').delete(pageId);
  const strokeKeys = await tx.objectStore('strokes').index('by-page').getAllKeys(pageId);
  for (const sk of strokeKeys) await tx.objectStore('strokes').delete(sk);
  const shapeKeys = await tx.objectStore('shapes').index('by-page').getAllKeys(pageId);
  for (const shk of shapeKeys) await tx.objectStore('shapes').delete(shk);
  const tbKeys = await tx.objectStore('textBlocks').index('by-page').getAllKeys(pageId);
  for (const tbk of tbKeys) await tx.objectStore('textBlocks').delete(tbk);

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
    await db.put('sections', updated);
    syncEngine.notifyChange({ sections: [updated] });
  }
}

export async function moveToTrashSection(sectionId: string): Promise<void> {
  const db = await getDB();
  const now = Date.now();
  const tx = db.transaction(['sections', 'pages'], 'readwrite');
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

  await tx.done;

  syncEngine.notifyDelete({
    sectionIds: [sectionId],
    pageIds,
  });
}

export async function restoreSection(sectionId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['sections', 'pages'], 'readwrite');
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
    await db.put('pages', page);
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
    await db.put('pages', page);
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
