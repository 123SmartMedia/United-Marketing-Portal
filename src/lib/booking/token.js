import crypto from 'node:crypto';

/**
 * Self-service cancel links.
 * --------------------------
 * The portal has no user login, so the confirmation email carries the only
 * proof of ownership: an HMAC over the booking id and date. Anyone holding the
 * link can cancel that one booking and nothing else.
 *
 * The secret is BOOKING_SECRET, falling back to UPLOAD_FINALIZE_SECRET so an
 * existing deployment works without a new variable. With neither set, booking
 * is refused rather than issuing links nobody could verify.
 */

const cleanEnv = (value) =>
  (value || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';

const MIN_SECRET_LENGTH = 16;

export function getBookingSecret(env = process.env) {
  const secret = cleanEnv(env.BOOKING_SECRET) || cleanEnv(env.UPLOAD_FINALIZE_SECRET);
  return secret.length >= MIN_SECRET_LENGTH ? secret : '';
}

export function createCancelToken({ id, date }, secret) {
  return crypto.createHmac('sha256', secret).update(`cancel:${id}:${date}`).digest('base64url');
}

export function verifyCancelToken({ id, date, token }, secret) {
  if (!secret || typeof token !== 'string') return false;
  const expected = Buffer.from(createCancelToken({ id, date }, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function cancelUrl(origin, { id, date }, secret) {
  const params = new URLSearchParams({ id, date, t: createCancelToken({ id, date }, secret) });
  return `${origin}/podcast-studio/cancel?${params}`;
}
