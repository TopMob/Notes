import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ISyncProvider, CloudPullResult } from './types';
import { Notebook, Section, Page } from '../../types/notebook';
import { Stroke, ShapeObject } from '../../types/canvas';
import { TextBlock } from '../../types/textblock';

export class SupabaseProvider implements ISyncProvider {
  name: 'supabase' = 'supabase';
  private client: SupabaseClient | null = null;

  constructor() {
    const url = import.meta.env.VITE_SUPABASE_URL || '';
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

    if (url && key) {
      this.client = createClient(url, key);
    }
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase client is not initialized. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
    }
    return this.client;
  }

  async pushNotebooks(userId: string, notebooks: Notebook[]): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    const rows = notebooks.map((nb) => ({
      id: nb.id,
      user_id: userId,
      title: nb.title,
      created_at: nb.createdAt,
      updated_at: now,
      order: nb.order,
      deleted_at: null,
    }));

    const { error } = await client.from('notebooks').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  async pushSections(userId: string, sections: Section[]): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    const rows = sections.map((sec) => ({
      id: sec.id,
      user_id: userId,
      notebook_id: sec.notebookId,
      title: sec.title,
      color: sec.color,
      order: sec.order,
      updated_at: now,
      deleted_at: null,
    }));

    const { error } = await client.from('sections').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  async pushPages(userId: string, pages: Page[]): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    const rows = pages.map((page) => ({
      id: page.id,
      user_id: userId,
      section_id: page.sectionId,
      title: page.title,
      created_at: page.createdAt,
      updated_at: now,
      order: page.order,
      camera: page.camera,
      background: page.background,
      deleted_at: null,
    }));

    const { error } = await client.from('pages').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  async pushPageElements(
    userId: string,
    pageId: string,
    elements: {
      strokes?: Stroke[];
      shapes?: ShapeObject[];
      textBlocks?: TextBlock[];
    }
  ): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    const rows: any[] = [];

    if (elements.strokes) {
      for (const s of elements.strokes) {
        rows.push({
          id: s.id,
          user_id: userId,
          page_id: pageId,
          type: 'stroke',
          data: s,
          updated_at: now,
          deleted_at: null,
        });
      }
    }

    if (elements.shapes) {
      for (const sh of elements.shapes) {
        rows.push({
          id: sh.id,
          user_id: userId,
          page_id: pageId,
          type: 'shape',
          data: sh,
          updated_at: now,
          deleted_at: null,
        });
      }
    }

    if (elements.textBlocks) {
      for (const tb of elements.textBlocks) {
        rows.push({
          id: tb.id,
          user_id: userId,
          page_id: pageId,
          type: 'textBlock',
          data: tb,
          updated_at: now,
          deleted_at: null,
        });
      }
    }

    if (rows.length > 0) {
      const { error } = await client.from('page_elements').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  async pullAll(userId: string, since: number = 0): Promise<CloudPullResult> {
    const client = this.getClient();

    const [nbRes, secRes, pageRes, elRes] = await Promise.all([
      client.from('notebooks').select('*').eq('user_id', userId).gt('updated_at', since),
      client.from('sections').select('*').eq('user_id', userId).gt('updated_at', since),
      client.from('pages').select('*').eq('user_id', userId).gt('updated_at', since),
      client.from('page_elements').select('*').eq('user_id', userId).gt('updated_at', since),
    ]);

    if (nbRes.error) throw nbRes.error;
    if (secRes.error) throw secRes.error;
    if (pageRes.error) throw pageRes.error;
    if (elRes.error) throw elRes.error;

    return {
      notebooks: (nbRes.data || []).map((r: any) => ({
        id: r.id,
        title: r.title,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        order: Number(r.order),
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
      sections: (secRes.data || []).map((r: any) => ({
        id: r.id,
        notebookId: r.notebook_id,
        title: r.title,
        color: r.color,
        order: Number(r.order),
        updatedAt: Number(r.updated_at),
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
      pages: (pageRes.data || []).map((r: any) => ({
        id: r.id,
        sectionId: r.section_id,
        title: r.title,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        order: Number(r.order),
        camera: r.camera || { x: 0, y: 0, zoom: 1 },
        background: r.background || { type: 'grid', color: '#ffffff' },
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
      elements: (elRes.data || []).map((r: any) => ({
        id: r.id,
        pageId: r.page_id,
        type: r.type,
        data: r.data,
        updatedAt: Number(r.updated_at),
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
    };
  }
}
