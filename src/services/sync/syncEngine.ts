import { create } from 'zustand';
import { SyncProviderType, SyncStatus, SyncPayload, ISyncProvider } from './types';
import { TursoProvider } from './tursoProvider';
import { SupabaseProvider, AccessTokenProvider } from './supabaseProvider';
import {
  loadNotebooks,
  loadSections,
  loadPages,
  loadPageData,
} from '../../db/storage';
import { getDB } from '../../db/idb';
import { Section, Page } from '../../types/notebook';
import { useNotebookStore } from '../../store/useNotebookStore';

interface SyncStoreState {
  providerType: SyncProviderType;
  status: SyncStatus;
  userId: string | null;
  lastSyncedAt: number | null;
  errorMessage: string | null;

  setProviderType: (type: SyncProviderType) => void;
  setUser: (userId: string | null) => void;
  setStatus: (status: SyncStatus) => void;
  setLastSyncedAt: (timestamp: number) => void;
  setError: (err: string | null) => void;
}

const STORAGE_PROVIDER_KEY = 'onenote_sync_provider';

export const useSyncStore = create<SyncStoreState>((set) => ({
  providerType: (localStorage.getItem(STORAGE_PROVIDER_KEY) as SyncProviderType) || 'turso',
  status: 'synced',
  userId: null,
  lastSyncedAt: null,
  errorMessage: null,

  setProviderType: (type) => {
    localStorage.setItem(STORAGE_PROVIDER_KEY, type);
    set({ providerType: type });
  },
  setUser: (userId) => set({ userId }),
  setStatus: (status) => set({ status }),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
  setError: (errorMessage) => set({ errorMessage, status: errorMessage ? 'error' : 'synced' }),
}));

class SyncEngine {
  private tursoProvider: TursoProvider;
  private supabaseProvider: SupabaseProvider;
  private idleTimer: any = null;
  private maxWaitTimer: any = null;
  private retryTimer: any = null;
  private retryDelay = 2000; // Начинаем повтор с 2 сек, удваиваем до 60 сек
  private readonly IDLE_DELAY = 15000; // 15 секунд бездействия
  private readonly MAX_WAIT = 60000;   // 1 минута непрерывной работы
  private pendingPayload: SyncPayload = {};

  constructor() {
    this.tursoProvider = new TursoProvider();
    this.supabaseProvider = new SupabaseProvider();

    // При закрытии или сворачивании вкладки гарантированно отправляем накопившиеся данные
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.flushPendingChanges();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flushPendingChanges();
        }
      });
    }
  }

  public setAuthTokenProvider(provider: AccessTokenProvider | null) {
    this.supabaseProvider.setTokenProvider(provider);
  }

  private getActiveProvider(): ISyncProvider | null {
    const { providerType } = useSyncStore.getState();
    if (providerType === 'turso') return this.tursoProvider;
    if (providerType === 'supabase') return this.supabaseProvider;
    return null; // 'local'
  }

  private mergePayloads(prev: SyncPayload, next: SyncPayload): SyncPayload {
    const mergeById = <T extends { id: string }>(a: T[] = [], b: T[] = []): T[] => {
      const map = new Map<string, T>();
      for (const item of a) map.set(item.id, item);
      for (const item of b) map.set(item.id, item);
      return Array.from(map.values());
    };

    const hasNextElements = next.pageElements && next.pageElements.pageId;
    const isSamePage = prev.pageElements?.pageId === next.pageElements?.pageId;

    return {
      notebooks: mergeById(prev.notebooks, next.notebooks),
      sections: mergeById(prev.sections, next.sections),
      pages: mergeById(prev.pages, next.pages),
      pageElements: hasNextElements
        ? {
            pageId: next.pageElements!.pageId,
            strokes: mergeById(
              isSamePage ? prev.pageElements?.strokes : [],
              next.pageElements!.strokes
            ),
            shapes: mergeById(
              isSamePage ? prev.pageElements?.shapes : [],
              next.pageElements!.shapes
            ),
            textBlocks: mergeById(
              isSamePage ? prev.pageElements?.textBlocks : [],
              next.pageElements!.textBlocks
            ),
          }
        : prev.pageElements,
    };
  }

  /**
   * Уведомление о локальном изменении данных.
   * Если пользователь залогинен и выбран облачный провайдер,
   * изменение ставится в очередь и отправляется:
   * - либо через 15 сек бездействия (idle),
   * - либо максимум через 60 сек активной непрерывной работы (maxWait).
   */
  public notifyChange(payload: SyncPayload) {
    const { userId, providerType } = useSyncStore.getState();
    if (!userId || providerType === 'local') {
      return; // Локальный режим, в сеть ничего не шлём
    }

    this.pendingPayload = this.mergePayloads(this.pendingPayload, payload);

    // Перезапуск таймера бездействия (15 секунд тишины после последнего действия)
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.flushPendingChanges();
    }, this.IDLE_DELAY);

    // Таймер максимального ожидания (не более 60 секунд задержки при непрерывной работе)
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        this.flushPendingChanges();
      }, this.MAX_WAIT);
    }
  }

  /**
   * Уведомление об удалении разделов или страниц
   */
  public notifyDelete(item: { sectionIds?: string[]; pageIds?: string[] }) {
    const { userId, providerType } = useSyncStore.getState();
    if (!userId || providerType === 'local') return;

    const provider = this.getActiveProvider();
    if (!provider) return;

    provider.deleteItems(userId, item).catch((err) => {
      console.error('[SyncEngine] Error deleting items in cloud:', err);
    });
  }

  public async flushPendingChanges() {
    // Сбрасываем таймеры
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    const { userId } = useSyncStore.getState();
    const provider = this.getActiveProvider();
    if (!userId || !provider) return;

    // Проверяем, есть ли накопленные данные
    const hasData =
      (this.pendingPayload.notebooks && this.pendingPayload.notebooks.length > 0) ||
      (this.pendingPayload.sections && this.pendingPayload.sections.length > 0) ||
      (this.pendingPayload.pages && this.pendingPayload.pages.length > 0) ||
      (this.pendingPayload.pageElements && this.pendingPayload.pageElements.pageId);

    if (!hasData) return;

    const payload = { ...this.pendingPayload };
    this.pendingPayload = {};

    useSyncStore.getState().setStatus('syncing');

    try {
      if (payload.notebooks && payload.notebooks.length > 0) {
        await provider.pushNotebooks(userId, payload.notebooks);
      }
      if (payload.sections && payload.sections.length > 0) {
        await provider.pushSections(userId, payload.sections);
      }
      if (payload.pages && payload.pages.length > 0) {
        await provider.pushPages(userId, payload.pages);
      }
      if (payload.pageElements && payload.pageElements.pageId) {
        await provider.pushPageElements(userId, payload.pageElements.pageId, payload.pageElements);
      }

      this.retryDelay = 2000;
      useSyncStore.getState().setStatus('synced');
      useSyncStore.getState().setLastSyncedAt(Date.now());
      useSyncStore.getState().setError(null);
    } catch (err: any) {
      console.error('[SyncEngine] Error flushing changes, restoring payload to queue:', err);
      // ВОССТАНОВЛЕНИЕ В ОЧЕРЕДЬ: мержим обратно
      this.pendingPayload = this.mergePayloads(payload, this.pendingPayload);
      useSyncStore.getState().setError(err.message || 'Ошибка синхронизации');

      // Планируем повтор с экспоненциальным backoff
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.flushPendingChanges();
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 60000);
    }
  }

  /**
   * Полная двусторонняя синхронизация:
   * 1. Подтягивает актуальные данные из облака.
   * 2. Если в локалке есть новые данные, отправляет их в облако.
   */
  public async syncAll(): Promise<void> {
    const { userId } = useSyncStore.getState();
    const provider = this.getActiveProvider();
    if (!userId || !provider) return;

    useSyncStore.getState().setStatus('syncing');

    try {
      // 1. Читаем локальные данные
      const localNotebooks = await loadNotebooks();
      const localSections: Section[] = [];
      const localPages: Page[] = [];

      for (const nb of localNotebooks) {
        const secs = await loadSections(nb.id);
        localSections.push(...secs);
        for (const sec of secs) {
          const pgs = await loadPages(sec.id);
          localPages.push(...pgs);
        }
      }

      const fallbackSecId = localSections[0]?.id || 'sec-quick-notes';
      for (const p of localPages) {
        if (!p.sectionId) p.sectionId = fallbackSecId;
      }

      // 2. Стягиваем облако
      const cloudData = await provider.pullAll(userId);

      // Если в облаке пусто, а локально уже есть данные пользователя -> пушим локалку в облако
      if (cloudData.notebooks.length === 0 && localNotebooks.length > 0) {
        await provider.pushNotebooks(userId, localNotebooks);
        if (localSections.length > 0) await provider.pushSections(userId, localSections);
        if (localPages.length > 0) await provider.pushPages(userId, localPages);

        for (const page of localPages) {
          const data = await loadPageData(page.id);
          await provider.pushPageElements(userId, page.id, data);
        }
      } else {
        // Если в облаке есть данные, обновляем локальную IndexedDB
        const db = await getDB();

        for (const cNb of cloudData.notebooks) {
          await db.put('notebooks', {
            id: cNb.id,
            title: cNb.title,
            createdAt: cNb.createdAt,
            order: cNb.order,
          });
        }

        for (const cSec of cloudData.sections) {
          if (cSec.deletedAt) {
            await db.delete('sections', cSec.id);
          } else {
            await db.put('sections', {
              id: cSec.id,
              notebookId: cSec.notebookId,
              title: cSec.title,
              color: cSec.color,
              order: cSec.order,
            });
          }
        }

        for (const cPg of cloudData.pages) {
          if (cPg.deletedAt) {
            await db.delete('pages', cPg.id);
          } else {
            await db.put('pages', {
              id: cPg.id,
              sectionId: cPg.sectionId || fallbackSecId,
              title: cPg.title,
              createdAt: cPg.createdAt,
              order: cPg.order,
              camera: cPg.camera,
              background: cPg.background,
            });
          }
        }

        // Обновляем элементы страниц
        for (const el of cloudData.elements) {
          if (el.deletedAt) {
            if (el.type === 'stroke') await db.delete('strokes', el.id);
            else if (el.type === 'shape') await db.delete('shapes', el.id);
            else if (el.type === 'textBlock') await db.delete('textBlocks', el.id);
          } else {
            if (el.type === 'stroke') {
              await db.put('strokes', el.data);
            } else if (el.type === 'shape') {
              await db.put('shapes', el.data);
            } else if (el.type === 'textBlock') {
              await db.put('textBlocks', el.data);
            }
          }
        }

        // Мгновенно обновляем интерфейс и активную страницу без перезагрузки браузера
        await useNotebookStore.getState().refreshFromStorage();
      }

      console.log(
        `[SyncEngine] syncAll completed successfully. Local: ${localNotebooks.length} notebooks, ${localPages.length} pages. Cloud elements: ${cloudData.elements.length}`
      );

      this.retryDelay = 2000;
      useSyncStore.getState().setStatus('synced');
      useSyncStore.getState().setLastSyncedAt(Date.now());
      useSyncStore.getState().setError(null);
    } catch (err: any) {
      console.error('[SyncEngine] syncAll failed:', err);
      useSyncStore.getState().setError(err.message || 'Ошибка синхронизации');
    }
  }
}

export const syncEngine = new SyncEngine();
