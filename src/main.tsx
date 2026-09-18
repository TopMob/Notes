import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';

const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  (import.meta.env as unknown as Record<string, string>).NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  '';

const CLERK_PROXY_URL =
  import.meta.env.VITE_CLERK_PROXY_URL ||
  (import.meta.env as unknown as Record<string, string>).NEXT_PUBLIC_CLERK_PROXY_URL ||
  '';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {CLERK_PUBLISHABLE_KEY ? (
      <ClerkProvider
        publishableKey={CLERK_PUBLISHABLE_KEY}
        afterSignOutUrl="/"
        {...(CLERK_PROXY_URL ? { proxyUrl: CLERK_PROXY_URL } : {})}
      >
        <App />
      </ClerkProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
