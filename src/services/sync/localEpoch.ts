export const LOCAL_SYNC_EPOCH_KEY = 'onenote_sync_local_epoch';
export const localSyncEpoch = () => localStorage.getItem(LOCAL_SYNC_EPOCH_KEY) || '';
export function invalidateLocalSyncEpoch() {
  try { localStorage.setItem(LOCAL_SYNC_EPOCH_KEY, crypto.randomUUID()); } catch {}
}
