import 'server-only';

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

/**
 * The finalize token.
 * -------------------
 * `/api/jira/requests/init` does the expensive, abusable work — Turnstile
 * redemption, validation, minting presigned PUTs. `/api/jira/requests/finalize`
 * must be able to trust that this exact browser already passed all of it, without
 * re-running the challenge and without keeping server state between two stateless
 * lambda invocations.
 *
 * So init hands back an opaque, signed, short-lived token that BINDS:
 *
 *   rid   request UUID          — the object-key namespace this submission owns
 *   idem  idempotency key       — ties the token to one submission attempt
 *   keys  permitted object keys — finalize will touch nothing else
 *   hash  canonical payload hash — the form cannot change between the two calls
 *   exp   expiry                 — the window is minutes, not hours
 *
 * It is a bearer token for one submission, not a session. It carries no user
 * data, no credentials and no R2 URL: the keys inside it are random ids that are
 * meaningless without the server's own R2 credentials.
 *
 * HMAC-SHA256 over the canonical JSON, compared in constant time. A tampered
 * field, a swapped key, an edited form or an expired window all fail the same
 * way — `invalid_token` — because telling a caller which part failed is free
 * information for an attacker.
 */

const TOKEN_VERSION = 'v1';
/** How long the browser has to upload its files and come back. */
export const FINALIZE_TOKEN_TTL_SECONDS = 900; // 15 minutes
/** Presigned PUTs are deliberately shorter-lived than the token itself. */
export const PRESIGN_TTL_SECONDS = 300; // 5 minutes — the contractual maximum

export const TOKEN_ERRORS = Object.freeze({
  NOT_CONFIGURED: 'finalize_secret_missing',
  MALFORMED: 'invalid_token',
  BAD_SIGNATURE: 'invalid_token',
  EXPIRED: 'token_expired',
});

const cleanEnv = (value) =>
  (value || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';

/**
 * The signing secret. Server-only, never bundled, never logged, no default.
 * An unset secret leaves the two-stage flow unconfigured rather than silently
 * signing with a guessable value.
 */
export function getFinalizeSecret(env = process.env) {
  return cleanEnv(env.UPLOAD_FINALIZE_SECRET);
}

export function isFinalizeConfigured(env = process.env) {
  // Short secrets are rejected: a 16-byte minimum keeps a placeholder like
  // "changeme" from ever being accepted as a signing key.
  return getFinalizeSecret(env).length >= 32;
}

const b64url = (buffer) => Buffer.from(buffer).toString('base64url');

/**
 * Canonical JSON: object keys sorted at every depth, so two structurally equal
 * payloads always produce byte-identical input to the hash. Without this, a
 * re-serialized form would hash differently purely by key order.
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

/**
 * Hash of the submission as it must remain between init and finalize.
 *
 * Deliberately excluded:
 *  - `turnstileToken` — single use, already spent at init, and absent at finalize
 *  - `files[].key`    — bound separately and more strictly by `keys`
 *  - `company`        — the honeypot, never part of the submission
 * Everything else, including each file's name/size/type, is covered: a payload
 * edited between the two calls no longer matches.
 */
export function hashPayload(submission, secret) {
  const { turnstileToken, company, files, submissionId, ...rest } = submission || {};
  const normalizedFiles = (Array.isArray(files) ? files : []).map((f) => ({
    name: String(f?.name ?? ''),
    size: Number(f?.size ?? 0),
    type: String(f?.type ?? ''),
  }));
  const canonical = canonicalize({ ...rest, files: normalizedFiles });
  // Keyed rather than plain SHA-256 so the hash cannot be recomputed offline
  // from a guessed payload without the secret.
  return createHmac('sha256', secret).update(canonical).digest('base64url');
}

export function newRequestId() {
  return randomUUID();
}

function sign(encodedPayload, secret) {
  return createHmac('sha256', secret).update(`${TOKEN_VERSION}.${encodedPayload}`).digest();
}

/**
 * Mint a finalize token.
 *
 * @param {object} params { requestId, idempotencyKey, keys, payloadHash, ttlSeconds }
 * @returns {string} `v1.<payload>.<signature>` — opaque to the browser
 */
export function createFinalizeToken(
  { requestId, idempotencyKey, keys, payloadHash, ttlSeconds = FINALIZE_TOKEN_TTL_SECONDS },
  env = process.env
) {
  const secret = getFinalizeSecret(env);
  if (!secret) throw new Error(TOKEN_ERRORS.NOT_CONFIGURED);

  const payload = {
    rid: requestId,
    idem: idempotencyKey || null,
    // Sorted so the token is stable regardless of upload order.
    keys: [...(keys || [])].sort(),
    hash: payloadHash,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const encoded = b64url(canonicalize(payload));
  return `${TOKEN_VERSION}.${encoded}.${b64url(sign(encoded, secret))}`;
}

/**
 * Verify and decode a finalize token.
 * Returns { ok: true, payload } or { ok: false, error }.
 * Never throws on malformed input — a hostile caller controls every byte here.
 */
export function verifyFinalizeToken(token, env = process.env) {
  const secret = getFinalizeSecret(env);
  if (!secret) return { ok: false, error: TOKEN_ERRORS.NOT_CONFIGURED };
  if (typeof token !== 'string' || token.length > 8192) {
    return { ok: false, error: TOKEN_ERRORS.MALFORMED };
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, error: TOKEN_ERRORS.MALFORMED };
  }
  const [, encoded, signature] = parts;

  let provided;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return { ok: false, error: TOKEN_ERRORS.MALFORMED };
  }

  const expected = sign(encoded, secret);
  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // length of a signature is not secret.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, error: TOKEN_ERRORS.BAD_SIGNATURE };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: TOKEN_ERRORS.MALFORMED };
  }

  if (
    !payload ||
    typeof payload.rid !== 'string' ||
    typeof payload.hash !== 'string' ||
    !Array.isArray(payload.keys) ||
    typeof payload.exp !== 'number'
  ) {
    return { ok: false, error: TOKEN_ERRORS.MALFORMED };
  }

  if (payload.exp * 1000 < Date.now()) {
    return { ok: false, error: TOKEN_ERRORS.EXPIRED };
  }

  return { ok: true, payload };
}

/** Constant-time comparison of two payload hashes. */
export function hashesMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
