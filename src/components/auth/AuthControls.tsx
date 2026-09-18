import React, { useEffect } from 'react';
import {
  useUser,
  useAuth,
  SignInButton,
  UserButton,
} from '@clerk/clerk-react';
import { LogIn } from 'lucide-react';
import { useSyncStore, syncEngine } from '../../services/sync/syncEngine';

export const AuthControls: React.FC = () => {
  const { isLoaded, isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const { setUser, providerType } = useSyncStore();

  useEffect(() => {
    if (isLoaded) {
      const currentUserId = isSignedIn && user ? user.id : null;
      setUser(currentUserId);

      if (isSignedIn) {
        // Подключаем мост авторизации Clerk -> Supabase с авто-обновлением токена
        syncEngine.setAuthTokenProvider(async () => {
          try {
            // Пробуем получить JWT по шаблону 'supabase', если он создан в Clerk Dashboard
            const supabaseToken = await getToken({ template: 'supabase' });
            if (supabaseToken) return supabaseToken;
          } catch {
            // fallback к стандартному токену сессии
          }
          try {
            return await getToken();
          } catch {
            return null;
          }
        });
      } else {
        syncEngine.setAuthTokenProvider(null);
      }

      // При первом входе автоматически запускаем синхронизацию
      if (currentUserId && providerType !== 'local') {
        syncEngine.syncAll();
      }
    }
  }, [isLoaded, isSignedIn, user, getToken, setUser, providerType]);

  if (!isLoaded) {
    return (
      <div className="auth-placeholder">
        <div className="auth-spinner" />
      </div>
    );
  }

  if (isSignedIn && user) {
    return (
      <div className="auth-user-wrapper" title={`Вы вошли как ${user.fullName || user.username || user.primaryEmailAddress?.emailAddress}`}>
        <UserButton
          appearance={{
            elements: {
              avatarBox: 'w-7 h-7 rounded-full ring-2 ring-purple-500/20',
            },
          }}
        />
      </div>
    );
  }

  return (
    <SignInButton mode="modal">
      <button className="auth-signin-btn" title="Войти для синхронизации">
        <LogIn size={14} />
        <span>Войти</span>
      </button>
    </SignInButton>
  );
};
