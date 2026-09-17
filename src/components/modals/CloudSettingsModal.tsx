import React, { useState } from 'react';
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

export const CloudSettingsModal: React.FC = () => {
  const { isCloudSettingsOpen, setCloudSettingsOpen } = useUiStore();
  const { providerType, setProviderType, status, lastSyncedAt, errorMessage } = useSyncStore();
  const { isSignedIn, user } = useUser();
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

  if (!isCloudSettingsOpen) return null;

  const handleProviderChange = (type: SyncProviderType) => {
    setProviderType(type);
    if (isSignedIn && type !== 'local') {
      syncEngine.syncAll();
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
      await syncEngine.syncAll();
      setSyncSuccessMsg('Синхронизация успешно завершена!');
      setTimeout(() => setSyncSuccessMsg(null), 3000);
    } catch (e: any) {
      // Ошибка отобразится через store
    } finally {
      setIsManualSyncing(false);
    }
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
                  <span className="badge-recommended">Быстро</span>
                  {providerType === 'turso' && <span className="active-pill">Активно</span>}
                </div>
                <p className="provider-desc">
                  Ультрабыстрый бессерверный SQLite. Мгновенный отклик, 9 ГБ хранилища в облаке.
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
                  Надёжная реляционная база Postgres для заметок и будущего медиа-хранилища.
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
