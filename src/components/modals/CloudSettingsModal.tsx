import React, { useState, useEffect } from 'react';
import {
  X,
  HardDrive,
  Zap,
  Database,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Cloud,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useUser } from '@clerk/clerk-react';
import { useSyncStore, syncEngine } from '../../services/sync/syncEngine';
import { useUiStore } from '../../store/useUiStore';
import { SyncProviderType } from '../../services/sync/types';
import { claimUnownedOutbox } from '../../services/sync/outbox';
import { isSyncOwner } from '../../services/sync/outboxContext';
import type { ConflictSummary } from '../../services/sync/conflicts';

export const CloudSettingsModal: React.FC = () => {
  const { isCloudSettingsOpen, setCloudSettingsOpen } = useUiStore();
  const { providerType, setProviderType, status, lastSyncedAt, errorMessage } = useSyncStore();
  const { isSignedIn, user } = useUser();
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictSummary[]>([]);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictHistory, setConflictHistory] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    setConflicts([]); setConflictError(null); setConflictHistory([]);
    if (isCloudSettingsOpen && providerType !== 'local' && isSignedIn) void Promise.all([syncEngine.getConflicts(), syncEngine.getConflictHistory()]).then(([rows, history]) => { if (current) { setConflicts(rows); setConflictHistory(history); } }).catch(() => { if (current) setConflictError('Не удалось прочитать облачные версии. Повторите синхронизацию после восстановления связи.'); });
    return () => { current = false; };
  }, [isCloudSettingsOpen, providerType, isSignedIn, user?.id, errorMessage]);

  if (!isCloudSettingsOpen) return null;

  const handleProviderChange = (type: SyncProviderType) => {
    setProviderType(type);
    if (isSignedIn && type !== 'local') {
      void syncEngine.syncAll().catch(() => {});
    }
  };

  const handleManualSync = async () => {
    if (!isSignedIn) {
      alert('Для синхронизации с облаком сначала выполните вход в аккаунт.');
      return;
    }
    if (providerType === 'local') {
      alert('У вас выбран локальный режим. Переключитесь на Turso или Supabase для облачной синхронизации.');
      return;
    }

    setIsManualSyncing(true);
    setSyncSuccessMsg(null);
    try {
      const stats = await syncEngine.syncAll();
      if (useSyncStore.getState().errorMessage) return;
      const pushedTotal = stats.pushed.notebooks + stats.pushed.sections + stats.pushed.pages;
      const pushedElem = stats.pushed.elements || 0;
      const pulledTotal = stats.pulled.notebooks + stats.pulled.sections + stats.pulled.pages;
      const pulledElem = stats.pulled.elements || 0;

      let msg = 'Синхронизация завершена!';
      if (pushedTotal > 0 || pulledTotal > 0 || pushedElem > 0 || pulledElem > 0) {
        const parts: string[] = [];
        if (pushedTotal > 0 || pushedElem > 0) {
          const detail = pushedElem > 0 ? ` (рисунков/блоков: ${pushedElem})` : '';
          parts.push(`отправлено: ${pushedTotal}${detail}`);
        }
        if (pulledTotal > 0 || pulledElem > 0) {
          const detail = pulledElem > 0 ? ` (рисунков/блоков: ${pulledElem})` : '';
          parts.push(`получено: ${pulledTotal}${detail}`);
        }
        msg = `Успешно: ${parts.join(', ')}`;
      } else {
        msg = 'Все блокноты, разделы, страницы и рисунки уже синхронизированы!';
      }
      setSyncSuccessMsg(msg);
      setTimeout(() => setSyncSuccessMsg(null), 6000);
    } catch (e: any) {
      // Ошибка отобразится через store
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleClaimDrafts = async () => {
    const userId = useSyncStore.getState().userId;
    if (!userId || providerType === 'local' || !isSyncOwner(userId)) return;
    setIsManualSyncing(true);
    setSyncSuccessMsg(null);
    try {
      await claimUnownedOutbox({ provider: providerType, userId });
      await syncEngine.syncAll();
    } catch (error) {
      useSyncStore.getState().setError(error instanceof Error ? error.message : 'Не удалось отправить локальные правки');
    } finally { setIsManualSyncing(false); }
  };

  const handleConflict = async (item: ConflictSummary, choice: 'local' | 'cloud') => {
    setIsManualSyncing(true); setConflictError(null); setSyncSuccessMsg(null);
    try {
      await syncEngine.chooseConflict(item.entity, item.id, choice);
      setConflicts(await syncEngine.getConflicts());
      setConflictHistory(await syncEngine.getConflictHistory());
    } catch (error) { setConflictError(error instanceof Error ? error.message : 'Не удалось выбрать версию'); }
    finally { setIsManualSyncing(false); }
  };

  return (
    <div className="modal-backdrop" onClick={() => setCloudSettingsOpen(false)}>
      <div className="modal-content cloud-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-with-icon">
            <Cloud size={20} className="modal-header-icon text-blue" />
            <h2>Хранилище и синхронизация</h2>
          </div>
          <button
            className="modal-close-btn"
            onClick={() => setCloudSettingsOpen(false)}
            title="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Статус пользователя */}
          <div className="cloud-user-status-card">
            <div className="user-status-avatar">
              {isSignedIn && user?.imageUrl ? (
                <img src={user.imageUrl} alt="Avatar" className="user-avatar-img" />
              ) : (
                <User size={20} />
              )}
            </div>
            <div className="user-status-details">
              <div className="user-status-name">
                {isSignedIn ? user?.fullName || user?.username || 'Авторизованный пользователь' : 'Гостевой режим'}
              </div>
              <div className="user-status-sub">
                {isSignedIn ? (
                  <span className="text-success">
                    <ShieldCheck size={13} className="inline-icon" /> Синхронизация между устройствами активна
                  </span>
                ) : (
                  <span className="text-muted">
                    Все заметки сохраняются в браузере (IndexedDB). Войдите для синхронизации.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Выбор провайдера */}
          <div className="cloud-section-title">Выберите хранилище данных:</div>

          <div className="cloud-providers-list">
            {/* 1. Локально */}
            <div
              className={`cloud-provider-card ${providerType === 'local' ? 'selected' : ''}`}
              onClick={() => handleProviderChange('local')}
            >
              <div className="provider-icon-wrapper local">
                <HardDrive size={22} />
              </div>
              <div className="provider-info">
                <div className="provider-header">
                  <span className="provider-name">Только на этом компьютере (IndexedDB)</span>
                  {providerType === 'local' && <span className="active-pill">Активно</span>}
                </div>
                <p className="provider-desc">
                  100% приватность. Данные не покидают браузер, работают моментально без интернета и без аккаунта.
                </p>
              </div>
            </div>

            {/* 2. Turso */}
            <div
              className={`cloud-provider-card ${providerType === 'turso' ? 'selected' : ''}`}
              onClick={() => handleProviderChange('turso')}
            >
              <div className="provider-icon-wrapper turso">
                <Zap size={22} />
              </div>
              <div className="provider-info">
                <div className="provider-header">
                  <span className="provider-name">Turso Cloud (libSQL / SQLite)</span>
                  <span className="badge-recommended">Рекомендуется</span>
                  {providerType === 'turso' && <span className="active-pill">Активно</span>}
                </div>
                <p className="provider-desc">
                  Ультрабыстрый бессерверный SQLite. Мгновенная синхронизация без задержек, стабильно работает во всех сетях и регионах.
                </p>
              </div>
            </div>

            {/* 3. Supabase */}
            <div
              className={`cloud-provider-card ${providerType === 'supabase' ? 'selected' : ''}`}
              onClick={() => handleProviderChange('supabase')}
            >
              <div className="provider-icon-wrapper supabase">
                <Database size={22} />
              </div>
              <div className="provider-info">
                <div className="provider-header">
                  <span className="provider-name">Supabase Cloud (PostgreSQL)</span>
                  {providerType === 'supabase' && <span className="active-pill">Активно</span>}
                </div>
                <p className="provider-desc">
                  Реляционная база Postgres. Внимание: в некоторых сетях РФ домены Supabase могут блокироваться провайдерами (ошибка соединения / TLS). Для стабильной работы без VPN рекомендуется Turso.
                </p>
              </div>
            </div>
          </div>

          {/* Индикатор статуса и ручной запуск */}
          {providerType !== 'local' && (
            <div className="cloud-sync-footer">
              <div className="sync-info-row">
                <span className="sync-info-label">Статус:</span>
                <span className={`sync-status-indicator ${status}`}>
                  {status === 'syncing' ? (
                    <>
                      <RefreshCw size={14} className="spinning" /> Синхронизация…
                    </>
                  ) : status === 'error' ? (
                    <>
                      <AlertCircle size={14} /> Ошибка синхронизации
                    </>
                  ) : (
                    <>
                      <CheckCircle size={14} /> Синхронизировано
                    </>
                  )}
                </span>
                {lastSyncedAt && (
                  <span className="sync-time">
                    (посл: {new Date(lastSyncedAt).toLocaleTimeString()})
                  </span>
                )}
              </div>

              {errorMessage && (
                <div className="sync-error-banner">
                  <AlertCircle size={14} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {errorMessage?.includes('сделанные до входа') && (
                <button className="btn-sync-now" disabled={isManualSyncing} onClick={handleClaimDrafts}>
                  Отправить правки до входа в аккаунт {user?.primaryEmailAddress?.emailAddress || user?.username || user?.id}
                </button>
              )}

              {conflictError && <div className="sync-error-banner"><AlertCircle size={14} /><span>{conflictError}</span></div>}
              {conflicts.length > 0 && <div className="sync-conflicts">
                <h3>Разные версии заметок</h3>
                <p>Выберите рабочую версию. Второй вариант страницы сохранится отдельной копией в её разделе; рисунки не смешиваются.</p>
                {conflicts.map(item => <div className="sync-conflict-card" key={`${item.entity}:${item.id}`}>
                  <div><strong>На устройстве:</strong> {item.localTitle}{item.entity === 'pages' && ` · объектов: ${item.localCount}`}</div>
                  <div><strong>В облаке:</strong> {item.cloudTitle}{item.entity === 'pages' && ` · объектов: ${item.cloudCount}`}</div>
                  {item.entity !== 'pages' && <p>Название второго варианта сохранится в истории синхронизации этого устройства.</p>}
                  <div className="sync-conflict-actions">
                    <button className="btn-secondary" disabled={isManualSyncing} onClick={() => handleConflict(item, 'local')}>Работать с локальной</button>
                    <button className="btn-secondary" disabled={isManualSyncing} onClick={() => handleConflict(item, 'cloud')}>Работать с облачной</button>
                  </div>
                </div>)}
              </div>}
              {conflictHistory.length > 0 && <details><summary>Сохранённые варианты названий</summary><ul>{conflictHistory.map((title, index) => <li key={index}>{title}</li>)}</ul></details>}

              {syncSuccessMsg && (
                <div className="sync-success-banner">
                  <CheckCircle size={14} />
                  <span>{syncSuccessMsg}</span>
                </div>
              )}

              <button
                className="btn-sync-now"
                onClick={handleManualSync}
                disabled={isManualSyncing || status === 'syncing'}
              >
                <RefreshCw size={15} className={isManualSyncing ? 'spinning' : ''} />
                <span>{isManualSyncing ? 'Синхронизируем...' : 'Синхронизировать сейчас'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--hairline)' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setCloudSettingsOpen(false)}
            style={{
              padding: '6px 18px',
              backgroundColor: 'var(--brand-onenote)',
              color: '#ffffff',
              borderRadius: 'var(--r-sm)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              border: 'none',
            }}
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
