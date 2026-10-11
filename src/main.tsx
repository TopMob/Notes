import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import { CLERK_PUBLISHABLE_KEY, CLERK_PROXY_URL } from './config/clerk';

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
