import { getDB } from '../../db/idb';
import { compressImageForUpload, CompressedImageResult } from './imageCompression';
export const ASSET_READY_EVENT = 'notes-asset-ready';

class AssetManager {
  private urlCache = new Map<string, string>();
  private blobCache = new Map<string, Blob>();
  private pendingLoads = new Map<string, Promise<string | null>>();
  private owners = new Map<string, number>();
  private releaseQueued = new Set<string>();
  private readonly maxCachedBytes = 32 * 1024 * 1024;
  private readonly maxCachedAssets = 64;

  /** A live image/export owns its URL; a released image can always reload its original. */
  public retain(id: string): () => void {
    this.releaseQueued.delete(id);
    this.owners.set(id, (this.owners.get(id) || 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.owners.get(id) || 1) - 1;
      if (count > 0) this.owners.set(id, count);
      else {
        this.owners.delete(id);
        this.releaseQueued.add(id);
        // StrictMode/content effects can acquire the same asset again this turn.
        queueMicrotask(() => {
          if (this.pendingLoads.has(id)) return;
          if (this.releaseQueued.delete(id) && !this.owners.has(id)) this.revoke(id);
        });
      }
    };
  }

  private trimCache(protectedId: string): void {
    let bytes = [...this.blobCache.values()].reduce((sum, blob) => sum + blob.size, 0);
    for (const [id, blob] of this.blobCache) {
      if (bytes <= this.maxCachedBytes && this.blobCache.size <= this.maxCachedAssets) break;
      if (id === protectedId || this.owners.has(id)) continue;
      bytes -= blob.size;
      this.revoke(id);
    }
  }

  /**
   * Регистрирует Blob в оперативной памяти и создаёт быстрый ObjectURL.
   * Выполняется синхронно за 0мс.
   */
  public registerAsset(id: string, blob: Blob): string {
    let url = this.urlCache.get(id);
    if (!url) {
      url = URL.createObjectURL(blob);
      this.urlCache.set(id, url);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ASSET_READY_EVENT, { detail: id }));
    }
    this.blobCache.set(id, blob);
    this.trimCache(id);
    return url;
  }

  /**
   * Мгновенное сохранение вставки изображения:
   * 1. URL создаётся синхронно (0ms), изображение тут же появляется на экране.
   * 2. Оригинальный Blob без сжатия асинхронно сохраняется в IndexedDB (local-first без потерь).
   */
  public async saveAsset(
    fileOrBlob: Blob,
    pageId?: string,
    name?: string
  ): Promise<{ id: string; url: string; width: number; height: number }> {
    const id = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const release = this.retain(id);
    const url = this.registerAsset(id, fileOrBlob);

    let width = 0;
    let height = 0;

    // Быстрое определение геометрических размеров в фоне
    try {
      if (typeof createImageBitmap !== 'undefined') {
        const bmp = await createImageBitmap(fileOrBlob);
        width = bmp.width;
        height = bmp.height;
        bmp.close();
      }
    } catch {
      // ignore
    }

    // Локальное сохранение оригинального бинарного Blob в IndexedDB
    try {
      const db = await getDB();
      await db.put('assets', {
        id,
        pageId,
        blob: fileOrBlob,
        mimeType: fileOrBlob.type || 'image/png',
        name,
        width,
        height,
        createdAt: Date.now(),
      });
    } catch (err) {
      release();
      this.revoke(id);
      console.error('[AssetManager] Failed to persist image:', err);
      throw new Error('Не удалось сохранить изображение на устройстве. Освободите место и повторите вставку.');
    }

    // Allow the caller to mount the image and acquire its own lease.
    setTimeout(release, 5000);
    return { id, url, width, height };
  }

  /**
   * Возвращает активный ObjectURL из памяти (синхронно).
   */
  public getUrl(id: string): string | null {
    return this.urlCache.get(id) || null;
  }

  /**
   * Возвращает ObjectURL, при необходимости восстанавливая его из IndexedDB (например, после перезагрузки страницы).
   */
  public async getOrLoadUrl(id: string): Promise<string | null> {
    const cached = this.urlCache.get(id);
    if (cached) return cached;

    if (this.pendingLoads.has(id)) {
      return this.pendingLoads.get(id)!;
    }

    const loadPromise = (async () => {
      try {
        const db = await getDB();
        const record = await db.get('assets', id);
        if (record && record.blob) {
          const url = this.registerAsset(id, record.blob);
          // An unmounted consumer may have released while IndexedDB was reading.
          if (this.releaseQueued.has(id) && !this.owners.has(id)) {
            this.revoke(id);
            return null;
          }
          return url;
        }
      } catch (err) {
        console.warn(`[AssetManager] Error loading asset ${id}:`, err);
      } finally {
        this.pendingLoads.delete(id);
        if (this.releaseQueued.delete(id) && !this.owners.has(id)) this.revoke(id);
      }
      return null;
    })();

    this.pendingLoads.set(id, loadPromise);
    return loadPromise;
  }

  /**
   * Возвращает оригинальный нетронутый бинарный Blob.
   */
  public async getBlob(id: string): Promise<Blob | null> {
    const cached = this.blobCache.get(id);
    if (cached) return cached;
    try {
      const db = await getDB();
      const record = await db.get('assets', id);
      if (record && record.blob) {
        this.blobCache.set(id, record.blob);
        this.trimCache(id);
        return record.blob;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Сжатие изображения перед отправкой в сеть (WebP бинарный Blob, не base64).
   * Локальный оригинал остаётся нетронутым!
   */
  public async compressForUpload(id: string): Promise<CompressedImageResult | null> {
    const rawBlob = await this.getBlob(id);
    if (!rawBlob) return null;
    return compressImageForUpload(rawBlob, { quality: 0.8, maxWidth: 2560, maxHeight: 2560 });
  }

  /**
   * Освобождение ресурсов памяти
   */
  public revoke(id: string): void {
    const url = this.urlCache.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.urlCache.delete(id);
    }
    this.blobCache.delete(id);
  }
}

export const assetManager = new AssetManager();
