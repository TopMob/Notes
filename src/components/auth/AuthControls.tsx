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

  const [loadTimedOut, setLoadTimedOut] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);

  useEffect(() => {
    if (!isLoaded) {
      // Даем планшетам и медленным сетям до 9 секунд до предупреждения
      const timer = setTimeout(() => {
        setLoadTimedOut(true);
        console.warn(
          '[Clerk Auth] Модуль авторизации Clerk не ответил за 9с. ' +
          'Возможные причины: домен *.clerk.accounts.dev недоступен без VPN в текущей сети, ' +
          'блокировка сторонних скриптов/CSP, либо нестабильное подключение.'
        );
      }, 9000);
      return () => clearTimeout(timer);
    } else {
      setLoadTimedOut(false);
    }
  }, [isLoaded, retryKey]);

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadTimedOut(false);
    setRetryKey((prev) => prev + 1);
    console.info('[Clerk Auth] Повторная попытка проверки статуса авторизации...');
  };

  if (!isLoaded) {
    if (loadTimedOut) {
      return (
        <div
          className="auth-placeholder"
          title="Не удалось подключиться к сервису авторизации Clerk. На устройствах без VPN домен может быть недоступен."
        >
          <div className="auth-error-badge">
            <span className="auth-error-text">Авторизация недоступна</span>
            <button
              type="button"
              className="auth-retry-btn"
              onClick={handleRetry}
              title="Повторить попытку подключения к Clerk"
            >
              Повторить
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="auth-placeholder" title="Загрузка профиля...">
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
