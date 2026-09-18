import { create } from 'zustand';
import { SyncProviderType, SyncStatus, SyncPayload, ISyncProvider } from './types';
import { TursoProvider } from './tursoProvider';
import { SupabaseProvider } from './supabaseProvider';
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
  private debounceTimer: any = null;
  private pendingPayload: SyncPayload = {};

  constructor() {
    this.tursoProvider = new TursoProvider();
    this.supabaseProvider = new SupabaseProvider();
  }

  private getActiveProvider(): ISyncProvider | null {
    const { providerType } = useSyncStore.getState();
    if (providerType === 'turso') return this.tursoProvider;
    if (providerType === 'supabase') return this.supabaseProvider;
    return null; // 'local'
  }

  /**
   * Уведомление о локальном изменении данных.
   * Если пользователь залогинен и выбран облачный провайдер,
   * изменение ставится в очередь и отправляется с дебаунсом 1.5 сек.
   */
  public notifyChange(payload: SyncPayload) {
    const { userId, providerType } = useSyncStore.getState();
    if (!userId || providerType === 'local') {
      return; // Локальный режим, в сеть ничего не шлём
    }

    const mergeById = <T extends { id: string }>(prev: T[] = [], next: T[] = []): T[] => {
      const map = new Map<string, T>();
      for (const item of prev) map.set(item.id, item);
      for (const item of next) map.set(item.id, item);
      return Array.from(map.values());
    };

    // Мержим в очередь с дедупликацией по id (сохраняем самую свежую версию)
    if (payload.notebooks) {
      this.pendingPayload.notebooks = mergeById(this.pendingPayload.notebooks, payload.notebooks);
    }
    if (payload.sections) {
      this.pendingPayload.sections = mergeById(this.pendingPayload.sections, payload.sections);
    }
    if (payload.pages) {
      this.pendingPayload.pages = mergeById(this.pendingPayload.pages, payload.pages);
    }
    if (payload.pageElements) {
      this.pendingPayload.pageElements = {
        pageId: payload.pageElements.pageId,
        strokes: mergeById(this.pendingPayload.pageElements?.strokes, payload.pageElements.strokes),
        shapes: mergeById(this.pendingPayload.pageElements?.shapes, payload.pageElements.shapes),
        textBlocks: mergeById(this.pendingPayload.pageElements?.textBlocks, payload.pageElements.textBlocks),
      };
    }

    useSyncStore.getState().setStatus('syncing');

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushPendingChanges();
    }, 1500);
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

  private async flushPendingChanges() {
    const { userId } = useSyncStore.getState();
    const provider = this.getActiveProvider();
    if (!userId || !provider) return;

    const payload = { ...this.pendingPayload };
    this.pendingPayload = {};

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

      useSyncStore.getState().setStatus('synced');
      useSyncStore.getState().setLastSyncedAt(Date.now());
      useSyncStore.getState().setError(null);
    } catch (err: any) {
      console.error('[SyncEngine] Error flushing changes:', err);
      useSyncStore.getState().setError(err.message || 'Ошибка синхронизации');
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
