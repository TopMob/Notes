import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Notebook, Section, Page } from '../types/notebook';
import { Stroke, ShapeObject } from '../types/canvas';
import { TextBlock } from '../types/textblock';

interface OneNoteDB extends DBSchema {
  notebooks: {
    key: string;
    value: Notebook;
    indexes: { 'by-order': number };
  };
  sections: {
    key: string;
    value: Section;
    indexes: { 'by-notebook': string; 'by-order': number };
  };
  pages: {
    key: string;
    value: Page;
    indexes: { 'by-section': string; 'by-order': number };
  };
  strokes: {
    key: string;
    value: Stroke;
    indexes: { 'by-page': string };
  };
  shapes: {
    key: string;
    value: ShapeObject;
    indexes: { 'by-page': string };
  };
  textBlocks: {
    key: string;
    value: TextBlock;
    indexes: { 'by-page': string };
  };
}

const DB_NAME = 'onenote_clone_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OneNoteDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<OneNoteDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OneNoteDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Notebooks
        if (!db.objectStoreNames.contains('notebooks')) {
          const nbStore = db.createObjectStore('notebooks', { keyPath: 'id' });
          nbStore.createIndex('by-order', 'order');
        }

        // Sections
        if (!db.objectStoreNames.contains('sections')) {
          const secStore = db.createObjectStore('sections', { keyPath: 'id' });
          secStore.createIndex('by-notebook', 'notebookId');
          secStore.createIndex('by-order', 'order');
        }

        // Pages
        if (!db.objectStoreNames.contains('pages')) {
          const pageStore = db.createObjectStore('pages', { keyPath: 'id' });
          pageStore.createIndex('by-section', 'sectionId');
          pageStore.createIndex('by-order', 'order');
        }

        // Strokes
        if (!db.objectStoreNames.contains('strokes')) {
          const strokeStore = db.createObjectStore('strokes', { keyPath: 'id' });
          strokeStore.createIndex('by-page', 'pageId');
        }

        // Shapes
        if (!db.objectStoreNames.contains('shapes')) {
          const shapeStore = db.createObjectStore('shapes', { keyPath: 'id' });
          shapeStore.createIndex('by-page', 'pageId');
        }

        // TextBlocks
        if (!db.objectStoreNames.contains('textBlocks')) {
          const tbStore = db.createObjectStore('textBlocks', { keyPath: 'id' });
          tbStore.createIndex('by-page', 'pageId');
        }
      },
    });
  }
  return dbPromise;
}
