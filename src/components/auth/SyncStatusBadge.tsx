import React from 'react';
import { RefreshCw, AlertCircle, HardDrive, CheckCircle2 } from 'lucide-react';
import { useSyncStore } from '../../services/sync/syncEngine';
import { useUiStore } from '../../store/useUiStore';

export const SyncStatusBadge: React.FC = () => {
  const { providerType, status, userId } = useSyncStore();
  const { setCloudSettingsOpen } = useUiStore();

  const isLocalOnly = !userId || providerType === 'local';

  return (
    <button
      className={`sync-badge-btn ${status} ${isLocalOnly ? 'mode-local' : 'mode-cloud'}`}
      onClick={() => setCloudSettingsOpen(true)}
      title="Настройки хранилища и синхронизации"
    >
      {isLocalOnly ? (
        <>
          <HardDrive size={14} className="badge-icon local" />
          <span className="badge-text">Локально</span>
        </>
      ) : status === 'syncing' ? (
        <>
          <RefreshCw size={14} className="badge-icon spinning" />
          <span className="badge-text">Синхронизация…</span>
        </>
      ) : status === 'error' ? (
        <>
          <AlertCircle size={14} className="badge-icon error" />
          <span className="badge-text">Ошибка</span>
        </>
      ) : (
        <>
          <CheckCircle2 size={14} className="badge-icon synced" />
          <span className="badge-text">
            {providerType === 'turso' ? 'Turso' : 'Supabase'}
          </span>
        </>
      )}
    </button>
  );
};
