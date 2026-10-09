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
    const response = await (await this.request({ action: 'pull' })).json();
    if (typeof response.payload !== 'string') throw new Error('Неполный ответ сервера синхронизации');
    return decompressJson<CloudPullResult>(response.payload);
  }
  async commit(_userId: string, operation: GuardedOperation): Promise<{ revision: string | null }> { return (await this.request({ action: 'commit', payload: await compressJson(operation) })).json(); }
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
