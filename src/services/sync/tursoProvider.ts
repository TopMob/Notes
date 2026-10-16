import type { ISyncProvider, CloudPullResult } from './types';
import type { Notebook, Section, Page } from '../../types/notebook';
import type { PageElementsBundle } from './compression';
import { compressJson, decompressJson } from './compression';
import type { AccessTokenProvider } from './supabaseProvider';
import type { GuardedOperation } from './revisionState';

export class TursoProvider implements ISyncProvider {
  name: 'turso' = 'turso';
  guarded = true;
  private tokenProvider: AccessTokenProvider | null = null;
  setTokenProvider(provider: AccessTokenProvider | null) { this.tokenProvider = provider; }
  private async request(body?: unknown, options: RequestInit = {}, query = ''): Promise<Response> {
    const token = await this.tokenProvider?.();
    if (!token) throw new Error('Войдите в аккаунт для синхронизации');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const incoming = await fetch(`/api/sync${query}`, { method: body ? 'POST' : 'GET', ...options, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...options.headers, Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : options.body, signal: controller.signal });
      // Keep the timeout until the body arrives, so a stalled stream cannot hold every tab's lock.
      const response = new Response(options.method === 'HEAD' ? null : await incoming.arrayBuffer(), { status: incoming.status, statusText: incoming.statusText, headers: incoming.headers });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const error = new Error(data?.error || 'Сервер синхронизации недоступен; локальные заметки сохранены') as Error & { status: number };
        error.status = response.status; throw error;
      }
      return response;
    } finally { clearTimeout(timer); }
  }
  async pullAll(_userId: string): Promise<CloudPullResult> {
    return this.readPull();
  }
  async getSyncToken(_userId: string): Promise<string> {
    const { token } = await (await this.request({ action: 'clock' })).json();
    if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) throw new Error('Некорректная отметка изменений облака');
    return token;
  }
  async pullEntities(_userId: string, entities: { entity: 'notebooks' | 'sections' | 'pages'; id: string }[]): Promise<CloudPullResult> {
    const result: CloudPullResult = { notebooks: [], sections: [], pages: [], elements: [], completePageIds: [], guarded: true };
    for (let offset = 0; offset < entities.length; offset += 256) {
      const batch = await this.readPull(entities.slice(offset, offset + 256));
      for (const table of ['notebooks', 'sections', 'pages', 'elements'] as const) (result[table] as any[]).push(...batch[table]);
      result.completePageIds!.push(...batch.completePageIds || []);
    }
    return result;
  }
  private async readPull(entities?: { entity: 'notebooks' | 'sections' | 'pages'; id: string }[]): Promise<CloudPullResult> {
    const response = await (await this.request({ action: 'pull', transport: 'chunks-v1', ...(entities ? { entities } : {}) })).json();
    if (response.transfer) {
      const first = response.transfer;
      if (typeof first.id !== 'string' || !/^[a-f0-9]{64}$/.test(first.hash || '') || !Number.isInteger(first.total) || first.total < 1 || first.total > 256) throw new Error('Некорректный снимок облака');
      const parts: string[] = [];
      for (let part = 0; part < first.total; part++) {
        const next = part === 0 ? first : (await (await this.request({ action: 'pull-part', id: first.id, part })).json()).transfer;
        if (!next || next.id !== first.id || next.hash !== first.hash || next.total !== first.total || next.part !== part || typeof next.data !== 'string' || next.data.length > 256 * 1024) throw new Error('Неполный снимок облака. Локальные заметки не изменены.');
        parts.push(next.data);
      }
      const payload = parts.join('');
      if (await this.payloadHash(payload) !== first.hash) throw new Error('Контрольная сумма снимка не совпала. Локальные заметки не изменены.');
      const cloud = await decompressJson<CloudPullResult>(payload);
      await this.request({ action: 'release-transfer', id: first.id }).catch(() => {});
      return cloud;
    }
    if (typeof response.payload !== 'string') throw new Error('Неполный ответ сервера синхронизации');
    return decompressJson<CloudPullResult>(response.payload);
  }
  private async payloadHash(payload: string): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  async commit(_userId: string, operation: GuardedOperation): Promise<{ revision: string | null; previousSyncToken?: string; syncToken?: string }> {
    const payload = await compressJson(operation);
    if (new TextEncoder().encode(JSON.stringify({ action: 'commit', payload })).length <= 2 * 1024 * 1024) return (await this.request({ action: 'commit', payload })).json();
    const size = 256 * 1024, total = Math.ceil(payload.length / size), id = crypto.randomUUID();
    if (total > 256) throw new Error('Страница слишком велика для текущей версии синхронизации. Локальная заметка и очередь сохранены.');
    const hash = await this.payloadHash(payload);
    for (let part = 0; part < total; part++) await this.request({ action: 'commit-part', id, total, part, hash, data: payload.slice(part * size, (part + 1) * size) });
    return (await this.request({ action: 'commit-transfer', id })).json();
  }
  async uploadAsset(id: string, blob: Blob): Promise<void> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
    const hash = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
    try {
      const existing = await this.request(undefined, { method: 'HEAD' }, `?${new URLSearchParams({ id })}`);
      if (existing.headers.get('X-Asset-Hash') === hash) return;
      throw new Error('Облачный ID изображения занят другим содержимым');
    } catch (error) { if ((error as Error & { status?: number }).status !== 404) throw error; }
    const chunk = 512 * 1024, total = Math.max(1, Math.ceil(blob.size / chunk));
    if (total > 128) throw new Error('Изображение превышает 64 МБ. Оригинал сохранён локально; облачная отправка приостановлена.');
    for (let part = 0; part < total; part++) await this.request(undefined, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Asset-Mime': blob.type || 'image/png' }, body: blob.slice(part * chunk, (part + 1) * chunk) }, `?${new URLSearchParams({ id, part: String(part), total: String(total), hash })}`);
  }
  async downloadAsset(id: string): Promise<Blob> {
    const manifest = await this.request(undefined, { method: 'HEAD' }, `?${new URLSearchParams({ id })}`);
    const total = Number(manifest.headers.get('X-Asset-Parts'));
    const expectedSize = Number(manifest.headers.get('X-Asset-Size'));
    const expectedHash = manifest.headers.get('X-Asset-Hash');
    if (!Number.isInteger(total) || total < 1 || total > 128 || !Number.isFinite(expectedSize) || expectedSize > 64 * 1024 * 1024) throw new Error('Некорректный manifest изображения');
    const chunks: Blob[] = [];
    for (let part = 0; part < total; part++) {
      const response = await this.request(undefined, {}, `?${new URLSearchParams({ id, part: String(part) })}`);
      if (response.headers.get('X-Asset-Hash') !== expectedHash || Number(response.headers.get('X-Asset-Parts')) !== total) throw new Error('Версия изображения изменилась во время загрузки');
      const chunk = await response.blob();
      if (chunk.size > 512 * 1024) throw new Error('Часть изображения превышает допустимый размер');
      chunks.push(chunk);
    }
    const blob = new Blob(chunks, { type: manifest.headers.get('Content-Type') || 'image/png' });
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== expectedHash || blob.size !== expectedSize) throw new Error('Контрольная сумма изображения не совпала; загрузка отменена');
    return blob;
  }
  async pushNotebooks(_userId: string, _rows: Notebook[]): Promise<void> { throw new Error('Отправка требует базовую ревизию'); }
  async pushSections(_userId: string, _rows: Section[]): Promise<void> { throw new Error('Отправка требует базовую ревизию'); }
  async pushPages(_userId: string, _rows: Page[]): Promise<void> { throw new Error('Отправка требует базовую ревизию'); }
  async pushPageElements(_userId: string, _id: string, _elements: Partial<PageElementsBundle>): Promise<void> { throw new Error('Отправка требует базовую ревизию'); }
  async deleteItems(_userId: string, _item: { notebookIds?: string[]; sectionIds?: string[]; pageIds?: string[] }): Promise<void> { throw new Error('Удаление требует базовую ревизию'); }
}
