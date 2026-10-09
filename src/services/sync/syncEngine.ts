import { create } from 'zustand';
import { SyncProviderType, SyncStatus, SyncPayload, ISyncProvider, SyncStats } from './types';
import { TursoProvider } from './tursoProvider';
import { SupabaseProvider, AccessTokenProvider } from './supabaseProvider';
import { loadPageData } from '../../db/storage';
import { getDB } from '../../db/idb';
import { Notebook, Section, Page } from '../../types/notebook';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useCanvasStore } from '../../store/useCanvasStore';
import { applyCloudPull, validateCloudPull } from './safePull';

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
  private operationTail: Promise<void> = Promise.resolve();
  private fullSyncPromise: Promise<SyncStats> | null = null;
  private changeRevision = 0;
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(operation);
    this.operationTail = next.then(() => {}, () => {});
    return next;
  }
  private tursoProvider: TursoProvider;
  private supabaseProvider: SupabaseProvider;
  private idleTimer: any = null;
  private maxWaitTimer: any = null;
  private retryTimer: any = null;
  private retryDelay = 2000;
  private readonly IDLE_DELAY = 3000; // 3 секунды тишины для автосохранения
  private readonly MAX_WAIT = 15000;  // 15 секунд непрерывной работы
  private pendingPayload: SyncPayload = {};
  private pendingPageElementIds = new Set<string>();

  constructor() {
    this.tursoProvider = new TursoProvider();
    this.supabaseProvider = new SupabaseProvider();

    // Best effort only; browsers may stop network work when a tab closes.
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
    this.changeRevision++;
    const { userId, providerType } = useSyncStore.getState();
    if (providerType === 'local') {
      return; // Локальный режим, в облако ничего не отправляем
    }

    if (payload.pageElements?.pageId) {
      this.pendingPageElementIds.add(payload.pageElements.pageId);
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
    this.changeRevision++;
    const { userId, providerType } = useSyncStore.getState();
    if (!userId || providerType === 'local') return;

    const provider = this.getActiveProvider();
    if (!provider) return;

    this.serialize(() => provider.deleteItems(userId, item)).catch((err) => {
      console.error('[SyncEngine] Error deleting items in cloud:', err);
      useSyncStore.getState().setError('Не удалось отправить удаление в облако. Локальные записи сохранены.');
    });
  }

  public flushPendingChanges(): Promise<boolean> {
    return this.serialize(() => this.flushPendingChangesNow());
  }

  private async flushPendingChangesNow(): Promise<boolean> {
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
    if (!userId || !provider) return true;

    const pageElementIdsToFlush = Array.from(this.pendingPageElementIds);
    this.pendingPageElementIds.clear();

    // Проверяем, есть ли накопленные данные
    const hasData =
      (this.pendingPayload.notebooks && this.pendingPayload.notebooks.length > 0) ||
      (this.pendingPayload.sections && this.pendingPayload.sections.length > 0) ||
      (this.pendingPayload.pages && this.pendingPayload.pages.length > 0) ||
      (this.pendingPayload.pageElements && this.pendingPayload.pageElements.pageId) ||
      pageElementIdsToFlush.length > 0;

    if (!hasData) return true;

    const payload = { ...this.pendingPayload };
    this.pendingPayload = {};

    if (payload.pageElements?.pageId && !pageElementIdsToFlush.includes(payload.pageElements.pageId)) {
      pageElementIdsToFlush.push(payload.pageElements.pageId);
    }

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

      // Для каждой изменённой страницы отправляем ПОЛНЫЙ срез данных из IndexedDB
      // Это гарантирует, что штрихи не затираются частичными diff-пакетами!
      for (const pageId of pageElementIdsToFlush) {
        const fullPageData = await loadPageData(pageId);
        await provider.pushPageElements(userId, pageId, fullPageData);
      }

      this.retryDelay = 2000;
      useSyncStore.getState().setStatus('synced');
      useSyncStore.getState().setError(null);
      const hasPending = this.pendingPageElementIds.size > 0 || ['notebooks', 'sections', 'pages'].some(key => this.pendingPayload[key as 'notebooks' | 'sections' | 'pages']?.length);
      useSyncStore.getState().setStatus(hasPending ? 'syncing' : 'synced');
      useSyncStore.getState().setLastSyncedAt(Date.now());
      return true;
    } catch (err: any) {
      console.error('[SyncEngine] Error flushing changes, restoring payload to queue:', err);
      // ВОССТАНОВЛЕНИЕ В ОЧЕРЕДЬ: мержим обратно
      this.pendingPayload = this.mergePayloads(payload, this.pendingPayload);
      for (const id of pageElementIdsToFlush) {
        this.pendingPageElementIds.add(id);
      }
      useSyncStore.getState().setError(err.message || 'Ошибка синхронизации');

      // Планируем повтор с экспоненциальным backoff
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.flushPendingChanges();
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 60000);
      return false;
    }
  }

  /**
   * Полная двусторонняя синхронизация:
   * 1. Сбрасывает текущие очереди изменений в сеть.
   * 2. Выполняет PUSH локальных данных (блокноты, разделы, страницы, элементы), которых еще нет в облаке.
   * 3. Выполняет PULL облачных данных в локальную базу IndexedDB.
   * 4. Применяет входящие данные атомарно; спорные замены и удаления сохраняют локальную версию.
   */
  public syncAll(): Promise<SyncStats> {
    if (this.fullSyncPromise) return this.fullSyncPromise;
    const operation = this.serialize(() => this.syncAllNow());
    this.fullSyncPromise = operation;
    void operation.then(() => { this.fullSyncPromise = null; }, () => { this.fullSyncPromise = null; });
    return operation;
  }

  private async syncAllNow(): Promise<SyncStats> {
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
      await useCanvasStore.getState().flushAllSaves();
      if (!await this.flushPendingChangesNow()) throw new Error('Отправка изменений не завершена. Загрузка облака приостановлена, локальные заметки сохранены.');

      // 2. Читаем все локальные данные из IndexedDB
      const snapshotRevision = this.changeRevision;
      const snapshotEdits = useCanvasStore.getState().getEditRevision();
      const db = await getDB();
      const localNotebooks = await db.getAll('notebooks');
      const localSections = await db.getAll('sections');
      const localPages = await db.getAll('pages');

      // 3. Получаем все данные из облака
      const cloudData = await provider.pullAll(userId);
      validateCloudPull(cloudData);
      if (snapshotRevision !== this.changeRevision || snapshotEdits !== useCanvasStore.getState().getEditRevision()) throw new Error('Во время загрузки облака появились локальные правки. Входящая синхронизация отменена; повторите после сохранения.');
      if (useSyncStore.getState().userId !== userId || this.getActiveProvider() !== provider) throw new Error('Аккаунт или провайдер изменился во время синхронизации');
      const pushedPageIds = new Set<string>();

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
          }
        }
      }

      if (pagesToPush.length > 0) {
        await provider.pushPages(userId, pagesToPush);
        pushedPages += pagesToPush.length;
        for (const page of pagesToPush) pushedPageIds.add(page.id);
      }

      // Г) Элементы страниц (штрихи, рисунки, фигуры, текст)
      let pushedElements = 0;
      for (const pg of localPages) {
        if (pg.deletedAt) continue;
        const pageData = await loadPageData(pg.id);
        const localElementsCount =
          pageData.strokes.length + pageData.shapes.length + pageData.textBlocks.length;
        const hasLocalElements = localElementsCount > 0;

        const cPg = cloudPageMap.get(pg.id);

        // Automatic reconciliation uploads only pages absent from the cloud.
        // Existing pages are sent through the explicit local-change queue, not timestamp guesses.
        if (!cPg && (hasLocalElements || pagesToPush.some((p) => p.id === pg.id))) {
          this.pendingPageElementIds.add(pg.id);
          await provider.pushPageElements(userId, pg.id, pageData);
          if (this.changeRevision === snapshotRevision) this.pendingPageElementIds.delete(pg.id);
          pushedPageIds.add(pg.id);
          pushedElements += localElementsCount;
        }
      }

      if (secIdsToDeleteInCloud.length > 0 || pageIdsToDeleteInCloud.length > 0) {
        await provider.deleteItems(userId, {
          sectionIds: secIdsToDeleteInCloud,
          pageIds: pageIdsToDeleteInCloud,
        });
      }

      if (snapshotRevision !== this.changeRevision || snapshotEdits !== useCanvasStore.getState().getEditRevision()) throw new Error('Локальные заметки изменились во время отправки. Загрузка облака приостановлена.');
      const protectedPageIds = new Set([...pushedPageIds, ...this.pendingPageElementIds, ...useCanvasStore.getState().getUnsavedPageIds()]);
      const editRevision = useCanvasStore.getState().getEditRevision();
      const changeRevision = this.changeRevision;
      const result = await applyCloudPull(db, cloudData, protectedPageIds, () =>
        useCanvasStore.getState().getEditRevision() === editRevision && this.changeRevision === changeRevision &&
        useSyncStore.getState().userId === userId && this.getActiveProvider() === provider);
      ({ notebooks: pulledNotebooks, sections: pulledSections, pages: pulledPages, elements: pulledElements } = result.pulled);

      // 6. Обновление UI хранилища
      const hasChanges = pulledNotebooks > 0 || pulledSections > 0 || pulledPages > 0 || pulledElements > 0;
      if (hasChanges && useCanvasStore.getState().saveStatus === 'saved') {
        await useNotebookStore.getState().refreshFromStorage();
      }

      console.log(
        `[SyncEngine] syncAll complete. Pushed: nb=${pushedNotebooks}, sec=${pushedSections}, pg=${pushedPages}, el=${pushedElements}. Pulled: nb=${pulledNotebooks}, sec=${pulledSections}, pg=${pulledPages}, el=${pulledElements}`
      );

      this.retryDelay = 2000;
      useSyncStore.getState().setStatus('synced');
      useSyncStore.getState().setError(null);

      if (result.conflicts.size) useSyncStore.getState().setError(`Различаются версии ${result.conflicts.size} страниц. Локальные рисунки и текст сохранены; автоматическая замена и облачное удаление этих страниц приостановлены.`);
      else useSyncStore.getState().setLastSyncedAt(Date.now());

      return {
        pushed: {
          notebooks: pushedNotebooks,
          sections: pushedSections,
          pages: pushedPages,
          elements: pushedElements,
        },
        pulled: {
          notebooks: pulledNotebooks,
          sections: pulledSections,
          pages: pulledPages,
          elements: pulledElements,
        },
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
      if (this.pendingPageElementIds.size && !this.retryTimer) {
        this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flushPendingChanges(); }, this.retryDelay);
      }
      throw err;
    }
  }
}

export const syncEngine = new SyncEngine();
