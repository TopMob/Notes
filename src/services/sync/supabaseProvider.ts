import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ISyncProvider, CloudPullResult } from './types';
import { Notebook, Section, Page } from '../../types/notebook';
import { Stroke, ShapeObject } from '../../types/canvas';
import { TextBlock } from '../../types/textblock';
import { compressBatch, decompressBatch, decompressJson } from './compression';

function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

export type AccessTokenProvider = () => Promise<string | null>;

export class SupabaseProvider implements ISyncProvider {
  name: 'supabase' = 'supabase';
  private client: SupabaseClient | null = null;
  private tokenProvider: AccessTokenProvider | null = null;

  constructor(tokenProvider?: AccessTokenProvider) {
    if (tokenProvider) {
      this.tokenProvider = tokenProvider;
    }
    this.initClient();
  }

  public setTokenProvider(tokenProvider: AccessTokenProvider | null) {
    this.tokenProvider = tokenProvider;
    this.initClient();
  }

  private initClient() {
    const url = import.meta.env.VITE_SUPABASE_URL || '';
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

    if (url && key) {
      this.client = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {},
        },
        accessToken: this.tokenProvider
          ? async () => {
              try {
                return (await this.tokenProvider!()) ?? null;
              } catch (e) {
                console.warn('[SupabaseProvider] Error obtaining access token:', e);
                return null;
              }
            }
          : undefined,
      });
    } else {
      this.client = null;
    }
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      this.initClient();
    }
    if (!this.client) {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) {
        throw new Error('Supabase URL или Anon Key не заданы в .env');
      }
      this.initClient();
    }
    return this.client!;
  }

  async pushNotebooks(userId: string, notebooks: Notebook[]): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    const rows = deduplicateById(
      notebooks.map((nb) => ({
        id: nb.id,
        user_id: userId,
        title: nb.title,
        created_at: nb.createdAt,
        updated_at: now,
        order: nb.order,
        deleted_at: null,
      }))
    );

    const { error } = await client.from('notebooks').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  async pushSections(userId: string, sections: Section[]): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    const rows = deduplicateById(
      sections.map((sec) => ({
        id: sec.id,
        user_id: userId,
        notebook_id: sec.notebookId,
        title: sec.title,
        color: sec.color,
        order: sec.order,
        updated_at: now,
        deleted_at: null,
      }))
    );

    const { error } = await client.from('sections').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  async pushPages(userId: string, pages: Page[]): Promise<void> {
    const client = this.getClient();
    const now = Date.now();

    // Защита от null value in column "section_id": восстанавливаем отсутствующий sectionId
    const rows = [];
    for (const page of pages) {
      let secId = page.sectionId;
      if (!secId) {
        try {
          const { data } = await client
            .from('pages')
            .select('section_id')
            .eq('id', page.id)
            .maybeSingle();
          if (data?.section_id) {
            secId = data.section_id;
          } else {
            const { data: sec } = await client
              .from('sections')
              .select('id')
              .eq('user_id', userId)
              .limit(1)
              .maybeSingle();
            secId = sec?.id || 'sec-quick-notes';
          }
        } catch {
          secId = 'sec-quick-notes';
        }
      }

      rows.push({
        id: page.id,
        user_id: userId,
        section_id: secId,
        title: page.title || 'Новая страница',
        created_at: page.createdAt || now,
        updated_at: now,
        order: page.order ?? 0,
        camera: page.camera,
        background: page.background,
        deleted_at: null,
      });
    }

    const uniqueRows = deduplicateById(rows);
    const { error } = await client.from('pages').upsert(uniqueRows, { onConflict: 'id' });
    if (error) throw error;
  }

  /**
   * Пакетное сохранение элементов страницы в Supabase.
   * Упаковывает элементы страницы в единый бандл (schema_version = 2),
   * обеспечивая лучшее сжатие и атомарность сохранения без перегрузки сети.
   */
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

    const compressedBatch = await compressBatch(elements);
    const bundleRow = {
      id: `bundle_${pageId}`,
      user_id: userId,
      page_id: pageId,
      type: 'bundle',
      data: compressedBatch,
      schema_version: 2,
      updated_at: now,
      deleted_at: null,
    };

    const { error } = await client.from('page_elements').upsert([bundleRow], { onConflict: 'id' });
    if (error) throw error;
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

    const parsedElements: CloudPullResult['elements'] = [];

    for (const r of elRes.data || []) {
      const updatedAt = Number(r.updated_at);
      const deletedAt = r.deleted_at ? Number(r.deleted_at) : null;

      if (r.type === 'bundle') {
        // Распаковываем пакетный бандл страницы (schema_version = 2)
        const bundle = await decompressBatch(r.data);
        for (const stroke of bundle.strokes) {
          parsedElements.push({
            id: stroke.id,
            pageId: r.page_id,
            type: 'stroke',
            data: stroke,
            updatedAt,
            deletedAt,
          });
        }
        for (const shape of bundle.shapes) {
          parsedElements.push({
            id: shape.id,
            pageId: r.page_id,
            type: 'shape',
            data: shape,
            updatedAt,
            deletedAt,
          });
        }
        for (const tb of bundle.textBlocks) {
          parsedElements.push({
            id: tb.id,
            pageId: r.page_id,
            type: 'textBlock',
            data: tb,
            updatedAt,
            deletedAt,
          });
        }
      } else {
        // Обратная совместимость для старых записей (schema_version = 1 или поэлементные)
        parsedElements.push({
          id: r.id,
          pageId: r.page_id,
          type: r.type,
          data: await decompressJson(r.data),
          updatedAt,
          deletedAt,
        });
      }
    }

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
      elements: parsedElements,
    };
  }

  async deleteItems(userId: string, item: { sectionIds?: string[]; pageIds?: string[] }): Promise<void> {
    const client = this.getClient();
    const now = Date.now();

    if (item.sectionIds && item.sectionIds.length > 0) {
      for (const id of item.sectionIds) {
        await client.from('sections').update({ deleted_at: now, updated_at: now }).eq('id', id).eq('user_id', userId);
        await client.from('pages').update({ deleted_at: now, updated_at: now }).eq('section_id', id).eq('user_id', userId);
      }
    }

    if (item.pageIds && item.pageIds.length > 0) {
      for (const id of item.pageIds) {
        await client.from('pages').update({ deleted_at: now, updated_at: now }).eq('id', id).eq('user_id', userId);
      }
    }
  }
}
