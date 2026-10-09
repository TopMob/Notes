import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ISyncProvider, CloudPullResult } from './types';
import { Notebook, Section, Page } from '../../types/notebook';
import { Stroke, ShapeObject } from '../../types/canvas';
import { TextBlock } from '../../types/textblock';
import { compressBatch } from './compression';
import { decodeCloudElements } from './cloudElements';
import { versionHash, portableElements, assetIds, cloudElementsFor } from './protocol.mjs';
import type { GuardedOperation } from './revisionState';

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
  guarded = true;
  private currentUserId: string | null = null;
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

  async pullAll(userId: string, _since: number = 0): Promise<CloudPullResult> {
    const client = this.getClient();
    this.currentUserId = userId;
    const { data, error } = await client.rpc('notes_pull_v1');
    if (error) throw new Error(error.code === 'PGRST202' ? 'Для защищённого синка Supabase установите scripts/supabase-sync-v1.sql. Локальные заметки сохранены; можно использовать Turso.' : 'Не удалось прочитать согласованный снимок Supabase');
    if (!data || !['notebooks', 'sections', 'pages', 'elements'].every(key => Array.isArray(data[key]))) throw new Error('Неполный снимок Supabase');
    const [nbRes, secRes, pageRes, elRes] = [data.notebooks, data.sections, data.pages, data.elements];

    const parsedElements = await decodeCloudElements(elRes);

    return {
      guarded: true,
      completePageIds: elRes.filter((r: any) => r.type === 'bundle' && !r.deleted_at).map((r: any) => String(r.page_id)),
      notebooks: nbRes.map((r: any) => ({
        id: r.id,
        title: r.title,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        order: Number(r.order),
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
      sections: secRes.map((r: any) => ({
        id: r.id,
        notebookId: r.notebook_id,
        title: r.title,
        color: r.color,
        order: Number(r.order),
        updatedAt: Number(r.updated_at),
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
      pages: pageRes.map((r: any) => ({
        id: r.id,
        sectionId: r.section_id,
        title: r.title,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        order: Number(r.order),
        camera: r.camera || { x: 0, y: 0, zoom: 1 },
        background: r.background || 'grid-small',
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
      elements: parsedElements,
    };
  }

  async commit(userId: string, input: GuardedOperation): Promise<{ revision: string | null }> {
    this.currentUserId = userId;
    const client = this.getClient();
    const { data: row, error: rowError } = await client.from(input.entity).select('*').eq('id', input.id).eq('user_id', userId).maybeSingle();
    if (rowError) throw rowError;
    let rawElements: any[] = [];
    if (input.entity === 'pages') {
      const { data, error } = await client.from('page_elements').select('*').eq('page_id', input.id).eq('user_id', userId);
      if (error) throw error; rawElements = data || [];
    }
    const decoded = await decodeCloudElements(rawElements);
    const elements = cloudElementsFor({ notebooks: [], sections: [], pages: [], elements: decoded }, input.id);
    const previous = row ? { id: row.id, title: row.title, order: Number(row.order), createdAt: Number(row.created_at), deletedAt: row.deleted_at, notebookId: row.notebook_id, color: row.color, sectionId: row.section_id, camera: row.camera, background: row.background } : null;
    const actual = await versionHash(input.entity, previous, elements);
    const desired = input.action === 'delete' ? previous && { ...previous, deletedAt: 1 } : { ...input.record, deletedAt: null };
    const desiredHash = await versionHash(input.entity, desired, input.elements);
    if (actual === desiredHash) return { revision: actual };
    if (actual !== input.expected) throw Object.assign(new Error('Облако изменилось на другом устройстве'), { status: 409 });
    const portable = input.entity === 'pages' ? portableElements(input.elements || {}) : undefined;
    const { error } = await client.rpc('notes_commit_v1', { entity: input.entity, entity_id: input.id, operation: input.action, expected_record: row, expected_elements: Object.fromEntries(rawElements.map(row => [row.id, row])), new_record: input.record || null, new_bundle: portable ? await compressBatch(portable) : null, asset_ids: portable ? assetIds(portable) : [] });
    if (error) {
      if (error.code === '40001' || error.code === '23505') throw Object.assign(new Error('Облако изменилось; обе версии сохранены'), { status: 409 });
      throw new Error(error.code === 'PGRST202' ? 'Для защищённой записи Supabase установите scripts/supabase-sync-v1.sql' : 'Запись Supabase не завершена; очередь сохранена');
    }
    return { revision: desiredHash };
  }
  private assetOwner() {
    if (!this.currentUserId) throw new Error('Аккаунт хранилища не определён');
    return this.currentUserId;
  }
  async uploadAsset(id: string, blob: Blob): Promise<void> {
    const userId = this.assetOwner(); const client = this.getClient();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
    const { data: existing, error: lookupError } = await client.from('notes_assets').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
    if (lookupError) throw new Error('Хранилище изображений Supabase не настроено; оригинал сохранён локально');
    if (existing) {
      if (existing.hash !== hash) throw new Error('ID изображения связан с другим содержимым');
      const { error } = await client.storage.from('notes-assets').info(existing.path);
      if (!error) return;
      if (String(error.statusCode) !== '404') throw error;
    }
    if (blob.size > 50 * 1024 * 1024) throw new Error('Изображение превышает лимит Supabase 50 МБ; оригинал сохранён локально');
    const path = `${userId}/${encodeURIComponent(id)}/${hash}`;
    const storage = client.storage.from('notes-assets');
    const { error: uploadError } = await storage.upload(path, blob, { upsert: false, contentType: blob.type || 'image/png' });
    if (uploadError) {
      if (String(uploadError.statusCode) !== '409' && String(uploadError.statusCode) !== '400') throw uploadError;
      const { data, error } = await storage.download(path);
      if (error || !data || [...new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('') !== hash) throw uploadError;
    }
    const { error } = await client.from('notes_assets').insert({ user_id: userId, id, path, hash, mime: blob.type || 'image/png' });
    if (error && error.code !== '23505') throw error;
    if (error) {
      const { data, error: verifyError } = await client.from('notes_assets').select('hash').eq('user_id', userId).eq('id', id).single();
      if (verifyError || data.hash !== hash) throw new Error('ID изображения занят другой версией');
    }
  }
  async downloadAsset(id: string): Promise<Blob> {
    const userId = this.assetOwner(); const client = this.getClient();
    const { data: record, error } = await client.from('notes_assets').select('*').eq('user_id', userId).eq('id', id).single();
    if (error) throw error;
    const { data, error: downloadError } = await client.storage.from('notes-assets').download(record.path);
    if (downloadError || !data) throw new Error('Изображение не загрузилось');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== record.hash) throw new Error('Контрольная сумма изображения не совпала');
    return data;
  }

  async deleteItems(userId: string, item: { notebookIds?: string[]; sectionIds?: string[]; pageIds?: string[] }): Promise<void> {
    const client = this.getClient();
    const now = Date.now();

    if (item.notebookIds && item.notebookIds.length > 0) {
      for (const id of item.notebookIds) {
        await client.from('notebooks').update({ deleted_at: now, updated_at: now }).eq('id', id).eq('user_id', userId).throwOnError();
        await client.from('sections').update({ deleted_at: now, updated_at: now }).eq('notebook_id', id).eq('user_id', userId).throwOnError();
      }
    }

    if (item.sectionIds && item.sectionIds.length > 0) {
      for (const id of item.sectionIds) {
        await client.from('sections').update({ deleted_at: now, updated_at: now }).eq('id', id).eq('user_id', userId).throwOnError();
        await client.from('pages').update({ deleted_at: now, updated_at: now }).eq('section_id', id).eq('user_id', userId).throwOnError();
      }
    }

    if (item.pageIds && item.pageIds.length > 0) {
      for (const id of item.pageIds) {
        await client.from('pages').update({ deleted_at: now, updated_at: now }).eq('id', id).eq('user_id', userId).throwOnError();
      }
    }
  }
}
