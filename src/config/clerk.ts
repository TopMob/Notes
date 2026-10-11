export const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  (import.meta.env as unknown as Record<string, string>).NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  '';

export const CLERK_PROXY_URL =
  import.meta.env.VITE_CLERK_PROXY_URL ||
  (import.meta.env as unknown as Record<string, string>).NEXT_PUBLIC_CLERK_PROXY_URL ||
  '';
