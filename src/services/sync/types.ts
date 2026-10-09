import { Notebook, Section, Page } from '../../types/notebook';
import { Stroke, ShapeObject } from '../../types/canvas';
import { TextBlock } from '../../types/textblock';
import type { GuardedOperation } from './revisionState';

export type SyncProviderType = 'local' | 'turso' | 'supabase';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export interface SyncPayload {
  notebooks?: Notebook[];
  sections?: Section[];
  pages?: Page[];
  pageElements?: {
    pageId: string;
    strokes?: Stroke[];
    shapes?: ShapeObject[];
    textBlocks?: TextBlock[];
  };
}

export interface CloudPullResult {
  guarded?: boolean;
  completePageIds?: string[];
  notebooks: (Notebook & { updatedAt: number; deletedAt?: number | null })[];
  sections: (Section & { updatedAt: number; deletedAt?: number | null })[];
  pages: (Page & { updatedAt: number; deletedAt?: number | null })[];
  elements: {
    id: string;
    pageId: string;
    type: 'stroke' | 'shape' | 'textBlock';
    data: any;
    updatedAt: number;
    deletedAt?: number | null;
  }[];
}

export interface SyncStats {
  pushed: {
    notebooks: number;
    sections: number;
    pages: number;
    elements?: number;
  };
  pulled: {
    notebooks: number;
    sections: number;
    pages: number;
    elements: number;
  };
}

export interface ISyncProvider {
  guarded?: boolean;
  commit?(userId: string, operation: GuardedOperation): Promise<{ revision: string | null }>;
  uploadAsset?(id: string, blob: Blob): Promise<void>;
  downloadAsset?(id: string): Promise<Blob>;
  name: SyncProviderType;
  pushNotebooks(userId: string, notebooks: Notebook[]): Promise<void>;
  pushSections(userId: string, sections: Section[]): Promise<void>;
  pushPages(userId: string, pages: Page[]): Promise<void>;
  pushPageElements(
    userId: string,
    pageId: string,
    elements: {
      strokes?: Stroke[];
      shapes?: ShapeObject[];
      textBlocks?: TextBlock[];
    }
  ): Promise<void>;
  pullAll(userId: string, since?: number): Promise<CloudPullResult>;
  deleteItems(userId: string, item: { notebookIds?: string[]; sectionIds?: string[]; pageIds?: string[] }): Promise<void>;
}
