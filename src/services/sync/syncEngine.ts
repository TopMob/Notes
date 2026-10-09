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
import { acknowledgeOutbox, pendingOutbox, readOutboxSnapshot, queueLocalChange, outboxSessionId } from './outbox';
import { isSyncOwner, rememberSyncOwner } from './outboxContext';
import { checkOutboxReplay } from './replaySafety';
import { getRevision, flagConflict } from './revisionState';
import { versionHash, cloudElementsFor, assetIds } from './protocol.mjs';
import type { OutboxEntry } from './outbox';
import { applyVersionedPull } from './revisionPull';
import { listConflicts, resolveConflict } from './conflicts';
import type { OutboxEntity } from './outbox';

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
    rememberSyncOwner(userId);
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
    const next = this.operationTail.then(async (): Promise<T> => {
      if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request('notes-cloud-sync', operation);
      return await operation();
    });
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

  public setAuthTokenProvider(provider: AccessTokenProvider | null, sessionProvider?: AccessTokenProvider | null) {
    this.supabaseProvider.setTokenProvider(provider);
    this.tursoProvider.setTokenProvider?.(sessionProvider === undefined ? provider : sessionProvider);
  }

  private getActiveProvider(): ISyncProvider | null {
    const { providerType } = useSyncStore.getState();
    if (providerType === 'turso') return this.tursoProvider;
    if (providerType === 'supabase') return this.supabaseProvider;
    return null; // 'local'
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

    // Intent was committed atomically by storage.ts; this notification only wakes the sender.

    if (!userId) {
      // Unsent intent survives in IndexedDB even while authentication is loading.
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
  public notifyDelete(_item: { notebookIds?: string[]; sectionIds?: string[]; pageIds?: string[] }) {
    this.changeRevision++;
    const { userId, providerType } = useSyncStore.getState();
    if (!userId || providerType === 'local') return;

    void this.flushPendingChanges();
  }

  public flushPendingChanges(): Promise<boolean> {
    return this.serialize(() => this.flushPendingChangesNow());
  }

  public async getConflicts() {
    const { userId, providerType } = useSyncStore.getState();
    const provider = this.getActiveProvider();
    if (!userId || !provider || providerType === 'local' || !isSyncOwner(userId)) return [];
    const result = await listConflicts(await getDB(), { provider: providerType, userId }, provider);
    if (useSyncStore.getState().userId !== userId || this.getActiveProvider() !== provider) throw new Error('Аккаунт изменился');
    return result;
  }

  public async getConflictHistory(): Promise<string[]> {
    const { userId, providerType } = useSyncStore.getState();
    if (!userId || providerType === 'local' || !isSyncOwner(userId)) return [];
    const rows = await (await getDB()).getAll('syncOutbox');
    if (useSyncStore.getState().userId !== userId || useSyncStore.getState().providerType !== providerType) return [];
    return rows.filter(row => row.provider === 'state' && row.bindingProvider === providerType && row.userId === userId).flatMap(row => 'alternatives' in row ? (row.alternatives || []).map(version => String(version.record.title || '')) : []);
  }

  public chooseConflict(entity: OutboxEntity, id: string, choice: 'local' | 'cloud'): Promise<void> {
    return this.serialize(async () => {
      const { userId, providerType } = useSyncStore.getState(); const provider = this.getActiveProvider();
      if (!userId || !provider?.guarded || providerType === 'local' || !isSyncOwner(userId)) throw new Error('Выбор версии доступен для текущего аккаунта облака');
      await useCanvasStore.getState().flushAllSaves();
      const edits = useCanvasStore.getState().getEditRevision();
      const isCurrent = () => useCanvasStore.getState().getEditRevision() === edits && useSyncStore.getState().userId === userId && this.getActiveProvider() === provider;
      await resolveConflict(await getDB(), { provider: providerType, userId }, provider, entity, id, choice, isCurrent);
      if (isCurrent()) await useNotebookStore.getState().refreshFromStorage();
      await this.flushPendingChangesNow();
    });
  }

  private async sendGuarded(provider: ISyncProvider, userId: string, entry: OutboxEntry, snapshot: NonNullable<Awaited<ReturnType<typeof readOutboxSnapshot>>>, cloud: import('./types').CloudPullResult, assertContext: () => void): Promise<boolean> {
    const db = await getDB();
    const state = await getRevision(db, entry, entry.entity, entry.entityId);
    const remote = cloud[entry.entity].find(row => row.id === entry.entityId);
    const remoteElements = entry.entity === 'pages' ? cloudElementsFor(cloud, entry.entityId) : undefined;
    const actual = await versionHash(entry.entity, remote, remoteElements);
    const deleting = entry.action === 'delete' || !!snapshot.record?.deletedAt;
    if (!deleting && !snapshot.record) throw new Error('Объект очереди отсутствует локально; пустая отправка заблокирована');
    const desiredRecord = deleting ? remote && { ...remote, deletedAt: 1 } : { ...snapshot.record, deletedAt: null };
    const desired = await versionHash(entry.entity, desiredRecord, snapshot.elements);
    assertContext();
    if (!state?.conflict && desired === actual) {
      if (!deleting && entry.entity === 'pages') await this.uploadPageAssets(db, provider, snapshot.elements || {}, assertContext);
      await acknowledgeOutbox(entry, actual); return true;
    }
    const expected = Object.prototype.hasOwnProperty.call(entry, 'base') ? entry.base : state?.base;
    if (state?.conflict || expected === undefined && actual !== null || expected !== undefined && expected !== actual) {
      await flagConflict(db, entry);
      useSyncStore.getState().setError('Есть разные версии заметок. Обе сохранены; откройте конфликты в настройках синхронизации.');
      return false;
    }
    if (!deleting && entry.entity === 'pages') await this.uploadPageAssets(db, provider, snapshot.elements || {}, assertContext);
    try {
      const result = await provider.commit!(userId, { entity: entry.entity, id: entry.entityId, action: deleting ? 'delete' : 'put', expected: expected ?? null, record: snapshot.record, elements: snapshot.elements || undefined });
      assertContext();
      await acknowledgeOutbox(entry, result.revision);
      const rows = cloud[entry.entity] as any[];
      const next = deleting ? remote && { ...remote, deletedAt: Date.now() } : { ...snapshot.record, deletedAt: null, updatedAt: Date.now() };
      if (next) { const index = rows.findIndex(row => row.id === entry.entityId); if (index < 0) rows.push(next); else rows[index] = next; }
      if (entry.entity === 'pages' && !deleting) {
        cloud.elements = cloud.elements.filter(el => el.pageId !== entry.entityId);
        for (const [key, type] of [['strokes', 'stroke'], ['shapes', 'shape'], ['textBlocks', 'textBlock']] as const) for (const data of snapshot.elements?.[key] || []) cloud.elements.push({ id: data.id, pageId: entry.entityId, type, data, updatedAt: Date.now() });
      }
      return true;
    } catch (error) {
      if ((error as Error & { status?: number }).status === 409) {
        await flagConflict(db, entry);
        useSyncStore.getState().setError('Облако изменилось во время отправки. Локальные правки сохранены; откройте конфликты в настройках синхронизации.');
        return false;
      }
      throw error;
    }
  }

  private async uploadPageAssets(db: Awaited<ReturnType<typeof getDB>>, provider: ISyncProvider, elements: Partial<import('./compression').PageElementsBundle>, assertContext: () => void) {
    for (const id of assetIds(elements)) {
      const asset = await db.get('assets', id);
      if (!asset?.blob || !provider.uploadAsset) throw new Error('Оригинал изображения отсутствует на этом устройстве. Отправка страницы приостановлена; другие версии сохранены.');
      await provider.uploadAsset(id, asset.blob); assertContext();
    }
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

    try {
      if (!isSyncOwner(userId)) throw new Error('Локальные заметки связаны с другим аккаунтом. Отправка в этот аккаунт остановлена.');
      const binding = { provider: useSyncStore.getState().providerType as 'turso' | 'supabase', userId };
      if ((await pendingOutbox({ ...binding, userId: null })).length) {
        useSyncStore.getState().setError('Есть локальные правки, сделанные до входа. В настройках облака выберите, отправлять ли их в этот аккаунт.');
        return false;
      }
      const entries = await pendingOutbox(binding);
      if (!entries.length) { this.pendingPageElementIds.clear(); return true; }
      useSyncStore.getState().setStatus('syncing');
      const restoredCloud = provider.guarded || entries.some(entry => entry.sessionId !== outboxSessionId) ? await provider.pullAll(userId) : null;
      if (restoredCloud) validateCloudPull(restoredCloud);
      const assertContext = () => {
        if (useSyncStore.getState().userId !== userId || this.getActiveProvider() !== provider || !isSyncOwner(userId)) throw new Error('Аккаунт или провайдер изменился; очередь сохранена для повтора.');
      };
      entries.sort((a, b) => ['notebooks', 'sections', 'pages'].indexOf(a.entity) - ['notebooks', 'sections', 'pages'].indexOf(b.entity));
      for (const entry of entries) {
        assertContext();
        const snapshot = await readOutboxSnapshot(entry);
        if (!snapshot) continue; // A newer operation replaced this entry.
        assertContext();
        if (provider.guarded && restoredCloud) {
          if (!await this.sendGuarded(provider, userId, entry, snapshot, restoredCloud, assertContext)) return false;
          continue;
        }
        if (restoredCloud && entry.sessionId !== outboxSessionId) {
          const replay = checkOutboxReplay(snapshot, restoredCloud);
          if (replay === 'conflict') {
            useSyncStore.getState().setError('После перезапуска локальные правки из очереди отличаются от облака. Обе версии оставлены на своих местах; автоматическая отправка остановлена до выбора версии.');
            return false;
          }
          if (replay === 'acknowledged') { await acknowledgeOutbox(entry); continue; }
        }
        if (entry.action === 'delete' || snapshot.record?.deletedAt) {
          const field = entry.entity === 'notebooks' ? 'notebookIds' : entry.entity === 'sections' ? 'sectionIds' : 'pageIds';
          await provider.deleteItems(userId, { [field]: [entry.entityId] });
        } else {
          if (!snapshot.record) throw new Error('Объект из очереди отсутствует локально. Отправка пустой страницы заблокирована.');
          if (entry.entity === 'notebooks') await provider.pushNotebooks(userId, [snapshot.notebook!]);
          else if (entry.entity === 'sections') await provider.pushSections(userId, [snapshot.section!]);
          else {
            await provider.pushPages(userId, [snapshot.page!]);
            assertContext();
            await provider.pushPageElements(userId, entry.entityId, snapshot.elements!);
          }
        }
        assertContext();
        await acknowledgeOutbox(entry);
      }
      const remaining = await pendingOutbox(binding);
      this.pendingPageElementIds = new Set(remaining.filter(entry => entry.entity === 'pages').map(entry => entry.entityId));
      this.retryDelay = 2000;
      useSyncStore.getState().setError(null);
      useSyncStore.getState().setStatus(remaining.length ? 'syncing' : 'synced');
      useSyncStore.getState().setLastSyncedAt(Date.now());
      if (remaining.length && !this.idleTimer) this.idleTimer = setTimeout(() => { this.idleTimer = null; void this.flushPendingChanges(); }, 500);
      return true;
    } catch (err: any) {
      console.error('[SyncEngine] Durable queue retained after send failure:', err);
      useSyncStore.getState().setError(err.message || 'Ошибка синхронизации');
      if (useSyncStore.getState().userId === userId && this.getActiveProvider() === provider && isSyncOwner(userId)) {
        this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flushPendingChanges(); }, this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 60000);
      }
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
      if (!await this.flushPendingChangesNow()) throw new Error(useSyncStore.getState().errorMessage || 'Отправка изменений не завершена. Загрузка облака приостановлена, локальные заметки сохранены.');

      // 2. Читаем все локальные данные из IndexedDB
      const snapshotRevision = this.changeRevision;
      const snapshotEdits = useCanvasStore.getState().getEditRevision();
      const db = await getDB();
      const localNotebooks = await db.getAll('notebooks');
      const localSections = await db.getAll('sections');
      const localPages = await db.getAll('pages');

      // 3. Получаем все данные из облака
      let cloudData = await provider.pullAll(userId);
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
      let pushedElements = 0;
      let pulledNotebooks = 0;
      let pulledSections = 0;
      let pulledPages = 0;
      let pulledElements = 0;

      // 4. ЭТАП PUSH: локальные данные -> в облако
      if (provider.guarded) {
        const uploaded = new Set<string>();
        for (const page of localPages) if (!page.deletedAt && cloudPageMap.has(page.id) && provider.uploadAsset) {
          const data = await loadPageData(page.id);
          for (const id of assetIds(data)) if (!uploaded.has(id)) {
            const asset = await db.get('assets', id);
            if (asset?.blob) { await provider.uploadAsset(id, asset.blob); uploaded.add(id); }
            if (useSyncStore.getState().userId !== userId || this.getActiveProvider() !== provider) throw new Error('Аккаунт изменился; синхронизация остановлена');
          }
        }
        const tx = db.transaction('syncOutbox', 'readwrite');
        for (const [entity, rows, remote] of [['notebooks', localNotebooks, cloudNbMap], ['sections', localSections, cloudSecMap], ['pages', localPages, cloudPageMap]] as const) {
          for (const row of rows) if (!row.deletedAt && !remote.has(row.id)) {
            await queueLocalChange(tx, entity, row.id);
            if (entity === 'notebooks') pushedNotebooks++;
            if (entity === 'sections') pushedSections++;
            if (entity === 'pages') pushedPages++;
          }
        }
        await tx.done;
        if (!await this.flushPendingChangesNow()) throw new Error(useSyncStore.getState().errorMessage || 'Очередь сохранена; отправка приостановлена');
        cloudData = await provider.pullAll(userId);
        validateCloudPull(cloudData);
      } else {
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
        pushedPages += pagesToPush.length;
        for (const page of pagesToPush) pushedPageIds.add(page.id);
      }

      // Г) Элементы страниц (штрихи, рисунки, фигуры, текст)
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
          const tx = db.transaction('syncOutbox', 'readwrite');
          await queueLocalChange(tx, 'pages', pg.id);
          await tx.done;
          if (!await this.flushPendingChangesNow()) throw new Error(useSyncStore.getState().errorMessage || 'Содержимое новой страницы осталось в очереди для повтора.');
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
      }

      if (snapshotRevision !== this.changeRevision || snapshotEdits !== useCanvasStore.getState().getEditRevision()) throw new Error('Локальные заметки изменились во время отправки. Загрузка облака приостановлена.');
      const pending = await pendingOutbox({ provider: useSyncStore.getState().providerType as 'turso' | 'supabase', userId });
      const protectedPageIds = new Set([...pushedPageIds, ...pending.filter(entry => entry.entity === 'pages').map(entry => entry.entityId), ...useCanvasStore.getState().getUnsavedPageIds()]);
      const editRevision = useCanvasStore.getState().getEditRevision();
      const changeRevision = this.changeRevision;
      const isCurrent = () =>
        useCanvasStore.getState().getEditRevision() === editRevision && this.changeRevision === changeRevision &&
        useSyncStore.getState().userId === userId && this.getActiveProvider() === provider;
      const result = provider.guarded ? await applyVersionedPull(db, cloudData, provider, { provider: provider.name as 'turso' | 'supabase', userId }, protectedPageIds, isCurrent) : await applyCloudPull(db, cloudData, protectedPageIds, isCurrent);
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
