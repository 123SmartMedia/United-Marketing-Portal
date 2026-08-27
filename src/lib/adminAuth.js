import 'server-only';
import crypto from 'node:crypto';

/**
 * Lightweight shared-password auth for the /admin area.
 * Login checks ADMIN_PASSWORD; on success we set an httpOnly, signed cookie
 * (HMAC over an expiry) that every admin route + the admin page verify.
 */

export const ADMIN_COOKIE = 'umd_admin';
const SESSION_DAYS = 14;

function password() {
  return (process.env.ADMIN_PASSWORD || '').trim();
}
function secret() {
  return (process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || '').trim();
}

export function isAdminConfigured() {
  return !!password();
}

export function verifyPassword(input) {
  const pw = password();
  if (!pw || typeof input !== 'string') return false;
  const a = Buffer.from(input);
  const b = Buffer.from(pw);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

/** Signed token: "<expiryMs>.<hmac>". */
export function issueToken() {
  const exp = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${exp}.${sign(exp)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [exp, mac] = token.split('.');
  if (!exp || !mac) return false;
  const expected = sign(exp);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};

/** Verify auth from a cookie store (next/headers cookies() or request.cookies). */
export function isAuthed(cookieStore) {
  const token = cookieStore?.get?.(ADMIN_COOKIE)?.value;
  return verifyToken(token);
}
