import { getDB } from './idb';
import { Notebook, Section, Page } from '../types/notebook';
import { Stroke, ShapeObject } from '../types/canvas';
import { TextBlock } from '../types/textblock';
import {
  INITIAL_NOTEBOOK,
  INITIAL_SECTIONS,
  INITIAL_PAGES,
  generateInitialStrokes,
  INITIAL_TEXT_BLOCK,
} from './initialData';

export async function initStorage(): Promise<void> {
  const db = await getDB();
  const existingNotebooks = await db.getAll('notebooks');

  if (existingNotebooks.length === 0) {
    const tx = db.transaction(
      ['notebooks', 'sections', 'pages', 'strokes', 'textBlocks'],
      'readwrite'
    );

    await tx.objectStore('notebooks').put(INITIAL_NOTEBOOK);

    for (const section of INITIAL_SECTIONS) {
      await tx.objectStore('sections').put(section);
    }

    for (const page of INITIAL_PAGES) {
      await tx.objectStore('pages').put(page);
    }

    // Добавляем штрихи для активной страницы
    const initialStrokes = generateInitialStrokes('page-17-09');
    for (const stroke of initialStrokes) {
      await tx.objectStore('strokes').put(stroke);
    }

    // Добавляем начальный текстовый блок
    await tx.objectStore('textBlocks').put(INITIAL_TEXT_BLOCK);

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
  return sections.sort((a, b) => a.order - b.order);
}

export async function loadPages(sectionId: string): Promise<Page[]> {
  const db = await getDB();
  const pages = await db.getAllFromIndex('pages', 'by-section', sectionId);
  return pages.sort((a, b) => a.order - b.order);
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

export async function savePageStrokes(pageId: string, strokes: Stroke[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('strokes', 'readwrite');
  const store = tx.objectStore('strokes');

  // Удаляем старые штрихи этой страницы
  const existing = await store.index('by-page').getAllKeys(pageId);
  for (const key of existing) {
    await store.delete(key);
  }

  // Записываем обновленные штрихи
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
  }
}

export async function createSection(section: Section): Promise<void> {
  const db = await getDB();
  await db.put('sections', section);
}

export async function createPage(page: Page): Promise<void> {
  const db = await getDB();
  await db.put('pages', page);
}

export async function deleteSection(sectionId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['sections', 'pages', 'strokes', 'shapes', 'textBlocks'], 'readwrite');

  const pages = await tx.objectStore('pages').index('by-section').getAll(sectionId);
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
}
