import { createRemoteJWKSet, jwtVerify } from 'jose';
import { SyncError } from './turso-sync.mjs';
const keySets = new Map();
export function clerkIssuer(env) {
  const key = env.CLERK_PUBLISHABLE_KEY || env.VITE_CLERK_PUBLISHABLE_KEY || env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
  if (!/^pk_(test|live)_/.test(key)) throw new SyncError(503, 'Серверная авторизация не настроена');
  const domain = Buffer.from(key.replace(/^pk_(test|live)_/, ''), 'base64').toString().replace(/\$$/, '');
  if (!/^[a-zA-Z0-9.-]+$/.test(domain) || !domain.includes('.')) throw new SyncError(503, 'Некорректная настройка авторизации');
  return `https://${domain}`;
}
export async function authenticate(headers, env = process.env, resolver) {
  const token = /^Bearer ([^\s]+)$/.exec(headers.authorization || '')?.[1];
  if (!token) throw new SyncError(401, 'Войдите в аккаунт для синхронизации');
  const issuer = clerkIssuer(env);
  if (!keySets.has(issuer)) keySets.set(issuer, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));
  let payload;
  try { ({ payload } = await jwtVerify(token, resolver || keySets.get(issuer), { issuer, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'nbf'] })); }
  catch { throw new SyncError(401, 'Сессия истекла. Повторите вход'); }
  const origins = (env.SYNC_ALLOWED_ORIGINS || 'https://infiniti-note.vercel.app').split(',').map(s => s.trim());
  if (env.VERCEL_URL) origins.push(`https://${env.VERCEL_URL}`);
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sts === 'pending' || payload.azp && !origins.includes(payload.azp)) throw new SyncError(401, 'Недопустимая сессия');
  return payload.sub;
}
