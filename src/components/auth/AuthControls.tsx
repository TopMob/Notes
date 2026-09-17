import React, { useEffect } from 'react';
import {
  useUser,
  SignInButton,
  UserButton,
} from '@clerk/clerk-react';
import { LogIn } from 'lucide-react';
import { useSyncStore, syncEngine } from '../../services/sync/syncEngine';

export const AuthControls: React.FC = () => {
  const { isLoaded, isSignedIn, user } = useUser();
  const { setUser, providerType } = useSyncStore();

  useEffect(() => {
    if (isLoaded) {
      const currentUserId = isSignedIn && user ? user.id : null;
      setUser(currentUserId);

      // При первом входе автоматически запускаем синхронизацию
      if (currentUserId && providerType !== 'local') {
        syncEngine.syncAll();
      }
    }
  }, [isLoaded, isSignedIn, user, setUser, providerType]);

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
