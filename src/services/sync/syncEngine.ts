import { create } from 'zustand';
import { SyncProviderType, SyncStatus, SyncPayload, ISyncProvider, SyncStats } from './types';
import { TursoProvider } from './tursoProvider';
import { SupabaseProvider, AccessTokenProvider } from './supabaseProvider';
import { loadPageData } from '../../db/storage';
import { getDB } from '../../db/idb';
import { Notebook, Section, Page } from '../../types/notebook';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useCanvasStore } from '../../store/useCanvasStore';

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
const STORAGE_LAST_SYNCED_KEY = 'onenote_last_synced_at';

const getInitialLastSyncedAt = (): number | null => {
  if (typeof localStorage === 'undefined') return null;
  const val = localStorage.getItem(STORAGE_LAST_SYNCED_KEY);
  const num = val ? Number(val) : NaN;
  return Number.isFinite(num) && num > 0 ? num : null;
};

export const useSyncStore = create<SyncStoreState>((set) => ({
  providerType: (localStorage.getItem(STORAGE_PROVIDER_KEY) as SyncProviderType) || 'turso',
  status: 'synced',
  userId: null,
  lastSyncedAt: getInitialLastSyncedAt(),
  errorMessage: null,

  setProviderType: (type) => {
    localStorage.setItem(STORAGE_PROVIDER_KEY, type);
    set({ providerType: type });
  },
  setUser: (userId) => {
    set({ userId });
    if (userId) {
      syncEngine.flushPendingChanges();
    }
  },
  setStatus: (status) => set({ status }),
  setLastSyncedAt: (lastSyncedAt) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_LAST_SYNCED_KEY, String(lastSyncedAt));
    }
    set({ lastSyncedAt });
  },
  setError: (errorMessage) => set({ errorMessage, status: errorMessage ? 'error' : 'synced' }),
}));

class SyncEngine {
  private tursoProvider: TursoProvider;
  private supabaseProvider: SupabaseProvider;
  private idleTimer: any = null;
  private maxWaitTimer: any = null;
  private retryTimer: any = null;
  private retryDelay = 2000;
  private readonly IDLE_DELAY = 3000; // 3 секунды тишины для автосохранения
  private readonly MAX_WAIT = 15000;  // 15 секунд непрерывной работы
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

  public notifyChange(payload: SyncPayload) {
    const { userId, providerType } = useSyncStore.getState();
    if (providerType === 'local') {
      return; // Локальный режим, в облако ничего не отправляем
    }

    // Всегда сохраняем в очередь изменений
    this.pendingPayload = this.mergePayloads(this.pendingPayload, payload);

    if (!userId) {
      // Если Clerk еще загружается, изменения сохранены в pendingPayload и уйдут после вызова setUser / syncAll
      return;
    }

    // Для структурных изменений (создание/изменение блокнота или раздела) отправляем быстрее (500мс)
    const isStructural =
      (payload.notebooks && payload.notebooks.length > 0) ||
      (payload.sections && payload.sections.length > 0);

    const delay = isStructural ? 500 : this.IDLE_DELAY;

    // Перезапуск таймера бездействия
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.flushPendingChanges();
    }, delay);

    // Таймер максимального ожидания
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        this.flushPendingChanges();
      }, this.MAX_WAIT);
    }
  }

  /**
   * Уведомление об удалении блокнотов, разделов или страниц
   */
  public notifyDelete(item: { notebookIds?: string[]; sectionIds?: string[]; pageIds?: string[] }) {
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
   * 1. Сбрасывает текущие очереди изменений в сеть.
   * 2. Выполняет PUSH локальных данных (блокноты, разделы, страницы, элементы), которых еще нет в облаке.
   * 3. Выполняет PULL облачных данных в локальную базу IndexedDB.
   * 4. Синхронизирует удаления в обе стороны.
   */
  public async syncAll(): Promise<SyncStats> {
    const { userId } = useSyncStore.getState();
    const provider = this.getActiveProvider();
    if (!userId || !provider) {
      return {
        pushed: { notebooks: 0, sections: 0, pages: 0 },
        pulled: { notebooks: 0, sections: 0, pages: 0, elements: 0 },
      };
    }

    useSyncStore.getState().setStatus('syncing');

    try {
      // 1. Сначала сбрасываем накопившиеся изменения из очереди
      await this.flushPendingChanges();

      // 2. Читаем все локальные данные из IndexedDB
      const db = await getDB();
      const localNotebooks = await db.getAll('notebooks');
      const localSections = await db.getAll('sections');
      const localPages = await db.getAll('pages');

      // 3. Получаем все данные из облака
      const cloudData = await provider.pullAll(userId);

      const cloudNbMap = new Map(cloudData.notebooks.map((n) => [n.id, n]));
      const cloudSecMap = new Map(cloudData.sections.map((s) => [s.id, s]));
      const cloudPageMap = new Map(cloudData.pages.map((p) => [p.id, p]));

      let pushedNotebooks = 0;
      let pushedSections = 0;
      let pushedPages = 0;
      let pulledNotebooks = 0;
      let pulledSections = 0;
      let pulledPages = 0;
      let pulledElements = 0;

      // 4. ЭТАП PUSH: локальные данные -> в облако
      // А) Блокноты
      const nbsToPush: Notebook[] = [];
      for (const nb of localNotebooks) {
        const cNb = cloudNbMap.get(nb.id);
        if (!cNb && !nb.deletedAt) {
          nbsToPush.push(nb);
        }
      }
      if (nbsToPush.length > 0) {
        await provider.pushNotebooks(userId, nbsToPush);
        pushedNotebooks += nbsToPush.length;
      }

      // Б) Разделы
      const secsToPush: Section[] = [];
      const secIdsToDeleteInCloud: string[] = [];
      for (const sec of localSections) {
        const cSec = cloudSecMap.get(sec.id);
        if (sec.deletedAt) {
          if (cSec && !cSec.deletedAt) {
            secIdsToDeleteInCloud.push(sec.id);
          }
        } else {
          if (!cSec) {
            secsToPush.push(sec);
          } else if (cSec.deletedAt && (sec.updatedAt || 0) > (cSec.deletedAt || 0)) {
            secsToPush.push(sec);
          }
        }
      }
      if (secsToPush.length > 0) {
        await provider.pushSections(userId, secsToPush);
        pushedSections += secsToPush.length;
      }

      // В) Страницы
      const pagesToPush: Page[] = [];
      const pageIdsToDeleteInCloud: string[] = [];
      for (const pg of localPages) {
        const cPg = cloudPageMap.get(pg.id);
        if (pg.deletedAt) {
          if (cPg && !cPg.deletedAt) {
            pageIdsToDeleteInCloud.push(pg.id);
          }
        } else {
          if (!cPg) {
            pagesToPush.push(pg);
          } else if (cPg.deletedAt && (pg.updatedAt || 0) > (cPg.deletedAt || 0)) {
            pagesToPush.push(pg);
          }
        }
      }
      if (pagesToPush.length > 0) {
        await provider.pushPages(userId, pagesToPush);
        pushedPages += pagesToPush.length;
        for (const pg of pagesToPush) {
          const pageData = await loadPageData(pg.id);
          await provider.pushPageElements(userId, pg.id, pageData);
        }
      }

      if (secIdsToDeleteInCloud.length > 0 || pageIdsToDeleteInCloud.length > 0) {
        await provider.deleteItems(userId, {
          sectionIds: secIdsToDeleteInCloud,
          pageIds: pageIdsToDeleteInCloud,
        });
      }

      // 5. ЭТАП PULL: облачные данные -> в локальную базу IndexedDB
      const localNbMap = new Map(localNotebooks.map((n) => [n.id, n]));
      const localSecMap = new Map(localSections.map((s) => [s.id, s]));
      const localPageMap = new Map(localPages.map((p) => [p.id, p]));

      const fallbackSecId =
        localSections.find((s) => !s.deletedAt)?.id ||
        cloudData.sections.find((s) => !s.deletedAt)?.id ||
        'sec-quick-notes';

      // Блокноты
      for (const cNb of cloudData.notebooks) {
        if (cNb.deletedAt) {
          if (localNbMap.has(cNb.id)) {
            await db.delete('notebooks', cNb.id);
            pulledNotebooks++;
          }
        } else {
          const lNb = localNbMap.get(cNb.id);
          if (!lNb || (cNb.updatedAt || 0) > (lNb.updatedAt || 0) || lNb.title !== cNb.title) {
            await db.put('notebooks', {
              id: cNb.id,
              title: cNb.title,
              createdAt: cNb.createdAt,
              updatedAt: cNb.updatedAt,
              order: cNb.order,
            });
            pulledNotebooks++;
          }
        }
      }

      // Разделы
      for (const cSec of cloudData.sections) {
        if (cSec.deletedAt) {
          if (localSecMap.has(cSec.id)) {
            await db.delete('sections', cSec.id);
            pulledSections++;
          }
        } else {
          const lSec = localSecMap.get(cSec.id);
          if (
            !lSec ||
            (cSec.updatedAt || 0) > (lSec.updatedAt || 0) ||
            lSec.title !== cSec.title ||
            lSec.color !== cSec.color
          ) {
            await db.put('sections', {
              id: cSec.id,
              notebookId: cSec.notebookId,
              title: cSec.title,
              color: cSec.color,
              order: cSec.order,
              updatedAt: cSec.updatedAt,
            });
            pulledSections++;
          }
        }
      }

      // Страницы
      for (const cPg of cloudData.pages) {
        if (cPg.deletedAt) {
          if (localPageMap.has(cPg.id)) {
            await db.delete('pages', cPg.id);
            pulledPages++;
          }
        } else {
          const lPg = localPageMap.get(cPg.id);
          if (!lPg || (cPg.updatedAt || 0) > (lPg.updatedAt || 0) || lPg.title !== cPg.title) {
            await db.put('pages', {
              id: cPg.id,
              sectionId: cPg.sectionId || fallbackSecId,
              title: cPg.title,
              createdAt: cPg.createdAt,
              updatedAt: cPg.updatedAt,
              order: cPg.order,
              camera: cPg.camera,
              background: cPg.background,
            });
            pulledPages++;
          }
        }
      }

      // Элементы страниц
      if (cloudData.elements.length > 0) {
        const tx = db.transaction(['strokes', 'shapes', 'textBlocks'], 'readwrite');
        const strokeStore = tx.objectStore('strokes');
        const shapeStore = tx.objectStore('shapes');
        const tbStore = tx.objectStore('textBlocks');

        for (const el of cloudData.elements) {
          if (el.deletedAt) {
            if (el.type === 'stroke') await strokeStore.delete(el.id);
            else if (el.type === 'shape') await shapeStore.delete(el.id);
            else if (el.type === 'textBlock') await tbStore.delete(el.id);
          } else {
            if (el.type === 'stroke') {
              await strokeStore.put(el.data);
              pulledElements++;
            } else if (el.type === 'shape') {
              await shapeStore.put(el.data);
              pulledElements++;
            } else if (el.type === 'textBlock') {
              await tbStore.put(el.data);
              pulledElements++;
            }
          }
        }
        await tx.done;
      }

      // 6. Обновление UI хранилища
      const hasChanges =
        pulledNotebooks > 0 ||
        pulledSections > 0 ||
        pulledPages > 0 ||
        pulledElements > 0 ||
        pushedNotebooks > 0 ||
        pushedSections > 0 ||
        pushedPages > 0;

      if (hasChanges) {
        await useNotebookStore.getState().refreshFromStorage();
      }

      const activePageId = useCanvasStore.getState().currentPageId;
      if (activePageId && cloudData.elements.some((e) => e.pageId === activePageId)) {
        const pageData = await loadPageData(activePageId);
        useCanvasStore.setState({
          strokes: pageData.strokes,
          shapes: pageData.shapes,
          textBlocks: pageData.textBlocks,
        });
      }

      console.log(
        `[SyncEngine] syncAll complete. Pushed: nb=${pushedNotebooks}, sec=${pushedSections}, pg=${pushedPages}. Pulled: nb=${pulledNotebooks}, sec=${pulledSections}, pg=${pulledPages}, el=${pulledElements}`
      );

      this.retryDelay = 2000;
      useSyncStore.getState().setStatus('synced');
      useSyncStore.getState().setLastSyncedAt(Date.now());
      useSyncStore.getState().setError(null);

      return {
        pushed: { notebooks: pushedNotebooks, sections: pushedSections, pages: pushedPages },
        pulled: { notebooks: pulledNotebooks, sections: pulledSections, pages: pulledPages, elements: pulledElements },
      };
    } catch (err: any) {
      console.error('[SyncEngine] syncAll failed:', err);
      let msg = err.message || 'Ошибка синхронизации';
      if (
        msg.includes('socket disconnected') ||
        msg.includes('ECONNRESET') ||
        msg.includes('Failed to fetch') ||
        msg.includes('Client network')
      ) {
        msg = 'Сервер недоступен (блокировка сети или сбой TLS). Рекомендуем переключиться на Turso.';
      }
      useSyncStore.getState().setError(msg);
      throw err;
    }
  }
}

export const syncEngine = new SyncEngine();
