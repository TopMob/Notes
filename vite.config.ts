import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Turso credentials are server-only, including when a module reads the whole env object.
  envPrefix: ['VITE_CLERK_PUBLISHABLE_KEY', 'VITE_CLERK_PROXY_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PROXY_URL'],
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
});
