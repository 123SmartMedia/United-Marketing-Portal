import 'server-only';

/**
 * Cloudflare Turnstile server-side verification.
 * ----------------------------------------------
 * `/custom-requests` is public and unauthenticated, so the widget in the browser
 * proves nothing on its own. Every submission's token is redeemed here, against
 * Cloudflare's siteverify endpoint, BEFORE any Jira call, any R2 read, or any
 * other work the request would cause.
 *
 * Turnstile tokens are single use and short lived, so replay, expiry and reuse
 * all surface as `timeout-or-duplicate` from Cloudflare and are rejected.
 *
 * Neither the token nor the secret is ever logged. Only Cloudflare's own
 * error-code strings (which contain no secret material) are recorded.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TOKEN_LENGTH = 2048;

export const TURNSTILE_RESULTS = Object.freeze({
  OK: 'ok',
  NOT_CONFIGURED: 'turnstile_not_configured',
  MISSING: 'turnstile_missing',
  MALFORMED: 'turnstile_malformed',
  FAILED: 'turnstile_failed',
  DUPLICATE: 'turnstile_duplicate',
  HOSTNAME_MISMATCH: 'turnstile_hostname_mismatch',
  ACTION_MISMATCH: 'turnstile_action_mismatch',
  TIMEOUT: 'turnstile_timeout',
  UNAVAILABLE: 'turnstile_unavailable',
});

const cleanEnv = (value) =>
  (value || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';

/**
 * Cloudflare's official test keys. They are published by Cloudflare and are not
 * secrets — they exist precisely so local development and CI never need a real
 * key. `TEST_SECRET_PASS` makes siteverify always succeed; `TEST_SECRET_FAIL`
 * makes it always fail, which is what the failure-path tests use.
 *
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const TURNSTILE_TEST_KEYS = Object.freeze({
  SITE_PASS_VISIBLE: '1x00000000000000000000AA',
  SITE_FAIL_VISIBLE: '2x00000000000000000000AB',
  SITE_FORCE_INTERACTIVE: '3x00000000000000000000FF',
  SECRET_PASS: '1x0000000000000000000000000000000AA',
  SECRET_FAIL: '2x0000000000000000000000000000000AA',
  SECRET_DUPLICATE: '3x0000000000000000000000000000000AA',
});

/** The action name the widget declares and the server requires. */
export const DEFAULT_TURNSTILE_ACTION = 'marketing_request';

export function getTurnstileConfig(env = process.env) {
  return {
    secretKey: cleanEnv(env.TURNSTILE_SECRET_KEY),
    // Reported for diagnostics only — verification never needs the site key.
    // Not NEXT_PUBLIC_*: Next inlines those at build time, which would freeze the
    // value. See src/lib/turnstileClientConfig.js.
    siteKey: cleanEnv(env.TURNSTILE_SITE_KEY),
    expectedHostname: cleanEnv(env.TURNSTILE_EXPECTED_HOSTNAME),
    // TURNSTILE_ACTION is the pre-hardening name, kept as a back-compat alias so
    // an existing deployment does not silently lose its action check.
    expectedAction: cleanEnv(env.TURNSTILE_EXPECTED_ACTION) || cleanEnv(env.TURNSTILE_ACTION),
    timeoutMs: Number.parseInt(cleanEnv(env.TURNSTILE_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Verification is enforced whenever a secret key is present.
 *
 * With no secret configured, submissions are allowed through and every one logs
 * a warning: that keeps local development usable without keys. Production MUST
 * set TURNSTILE_SECRET_KEY — it is on the launch checklist, and the warning is
 * deliberately loud so a misconfigured deploy is visible in the function logs.
 */
export function isTurnstileEnforced(config = getTurnstileConfig()) {
  return Boolean(config.secretKey);
}

/** Cloudflare error codes that mean "this token was already spent or expired". */
const DUPLICATE_CODES = new Set(['timeout-or-duplicate']);
const MALFORMED_CODES = new Set([
  'invalid-input-response',
  'bad-request',
  'invalid-parsed-secret',
  'missing-input-response',
]);

function classifyErrorCodes(codes) {
  const list = Array.isArray(codes) ? codes : [];
  if (list.some((code) => DUPLICATE_CODES.has(code))) return TURNSTILE_RESULTS.DUPLICATE;
  if (list.some((code) => MALFORMED_CODES.has(code))) return TURNSTILE_RESULTS.MALFORMED;
  return TURNSTILE_RESULTS.FAILED;
}

/**
 * Redeem a Turnstile token.
 *
 * @param {string} token            the `cf-turnstile-response` value from the form
 * @param {object} options          { remoteIp, idempotencyKey, config, env }
 * @returns {Promise<{ok: boolean, result: string, codes?: string[], skipped?: boolean}>}
 */
export async function verifyTurnstileToken(token, { remoteIp, idempotencyKey, config = getTurnstileConfig() } = {}) {
  if (!isTurnstileEnforced(config)) {
    console.warn(
      '[turnstile] TURNSTILE_SECRET_KEY is not set — bot protection is DISABLED for this submission. ' +
        'Set it before serving this form publicly.'
    );
    return { ok: true, result: TURNSTILE_RESULTS.NOT_CONFIGURED, skipped: true };
  }

  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, result: TURNSTILE_RESULTS.MISSING };
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, result: TURNSTILE_RESULTS.MALFORMED };
  }

  const form = new URLSearchParams();
  form.set('secret', config.secretKey);
  form.set('response', token);
  if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp);
  // Lets Cloudflare de-duplicate our own retries of the same verification.
  if (idempotencyKey) form.set('idempotency_key', idempotencyKey);

  let response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: 'no-store',
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return { ok: false, result: TURNSTILE_RESULTS.TIMEOUT };
    }
    return { ok: false, result: TURNSTILE_RESULTS.UNAVAILABLE };
  }

  if (!response.ok) {
    return { ok: false, result: TURNSTILE_RESULTS.UNAVAILABLE };
  }

  let outcome;
  try {
    outcome = await response.json();
  } catch {
    return { ok: false, result: TURNSTILE_RESULTS.UNAVAILABLE };
  }

  if (!outcome?.success) {
    return { ok: false, result: classifyErrorCodes(outcome?.['error-codes']), codes: outcome?.['error-codes'] };
  }

  // A successful signature is not enough: confirm the challenge was solved on
  // our own hostname, so a token minted on an attacker's copy of the form is
  // useless here.
  if (config.expectedHostname && outcome.hostname !== config.expectedHostname) {
    return { ok: false, result: TURNSTILE_RESULTS.HOSTNAME_MISMATCH };
  }
  if (config.expectedAction && outcome.action !== config.expectedAction) {
    return { ok: false, result: TURNSTILE_RESULTS.ACTION_MISMATCH };
  }

  return { ok: true, result: TURNSTILE_RESULTS.OK };
}
