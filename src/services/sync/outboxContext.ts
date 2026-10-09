import type { SyncProviderType } from './types';

const OWNER_KEY = 'onenote_sync_owner';
export interface SyncBinding { provider: Exclude<SyncProviderType, 'local'>; userId: string | null }
export function getSyncBinding(): SyncBinding | null {
  const provider = localStorage.getItem('onenote_sync_provider') || 'turso';
  if (provider !== 'turso' && provider !== 'supabase') return null;
  return { provider, userId: localStorage.getItem(OWNER_KEY) || null };
}
export function rememberSyncOwner(userId: string | null): void {
  if (userId && !localStorage.getItem(OWNER_KEY)) localStorage.setItem(OWNER_KEY, userId);
}
export function isSyncOwner(userId: string): boolean {
  const owner = localStorage.getItem(OWNER_KEY);
  return !owner || owner === userId;
}
