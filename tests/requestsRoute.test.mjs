import test from 'node:test';
import assert from 'node:assert/strict';

import { POST } from '../src/app/api/requests/route.js';
import { GET as TURNSTILE_CONFIG } from '../src/app/api/turnstile-config/route.js';
import { __resetRateLimitState } from '../src/lib/rateLimit.js';

/**
 * /api/requests — the inline Get Started / category-page form. It sends mail
 * from marketing@, so it must not be an open relay: same-origin, throttled,
 * United Mortgage emails only (closed by default), and Turnstile-gated.
 * SendGrid is unset, so delivery logs instead of sending; siteverify is mocked.
 */

const ORIGIN = 'https://marketing.unitedmortgage.com';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const ENV = {
  SENDGRID_API_KEY: undefined,
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_EXPECTED_HOSTNAME: 'marketing.unitedmortgage.com',
  TURNSTILE_EXPECTED_ACTION: undefined,
  TURNSTILE_ACTION: undefined,
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  ALLOWED_REQUEST_EMAIL_DOMAINS: undefined,
};

const VALID = {
  source: 'get-started',
  requestType: 'Custom Request',
  name: 'Sam Officer',
  email: 'sofficer@unitedmortgage.com',
  details: 'Need 500 cards for a new hire.',
  turnstileToken: 'token',
};

function post(body, { origin = ORIGIN, ip = '10.2.0.1' } = {}) {
  return new Request(`${ORIGIN}/api/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { origin } : {}),
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

async function withEnv(fetchImpl, fn, overrides = {}) {
  const saved = {};
  for (const [key, value] of Object.entries({ ...ENV, ...overrides })) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const noNetwork = async (url) => {
  throw new Error(`unexpected network call: ${url}`);
};
const turnstilePasses = async (url) => {
  if (String(url) !== SITEVERIFY) throw new Error(`unexpected network call: ${url}`);
  return new Response(JSON.stringify({ success: true, hostname: 'marketing.unitedmortgage.com' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

test.beforeEach(() => __resetRateLimitState());

test('happy path: verified United Mortgage submitter is delivered', async () => {
  const res = await withEnv(turnstilePasses, () => POST(post(VALID)));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('cross-origin posts are refused', async () => {
  const res = await withEnv(noNetwork, () => POST(post(VALID, { origin: 'https://evil.test' })));
  assert.equal(res.status, 403);
});

test('non-company email is refused before Turnstile, even with no allow-list configured', async () => {
  const res = await withEnv(noNetwork, () => POST(post({ ...VALID, email: 'victim@gmail.com' })));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'email_domain_not_allowed');
});

test('ALLOWED_REQUEST_EMAIL_DOMAINS overrides the default', async () => {
  const res = await withEnv(turnstilePasses, () => POST(post({ ...VALID, email: 'a@partner.com' })), {
    ALLOWED_REQUEST_EMAIL_DOMAINS: 'partner.com',
  });
  assert.equal(res.status, 200);
});

test('missing Turnstile token is refused', async () => {
  const res = await withEnv(noNetwork, () => POST(post({ ...VALID, turnstileToken: '' })));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.resetChallenge, true);
  assert.match(json.error, /^turnstile_/);
});

test('rate limit kicks in per IP', async () => {
  await withEnv(turnstilePasses, async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await POST(post(VALID))).status, 200);
    const limited = await POST(post(VALID));
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('Retry-After'));
    // A different IP is unaffected.
    assert.equal((await POST(post(VALID, { ip: '10.2.0.99' }))).status, 200);
  });
});

test('honeypot is accepted silently without any network call', async () => {
  const res = await withEnv(noNetwork, () => POST(post({ ...VALID, company: 'Bot Co' })));
  assert.equal(res.status, 200);
});

test('invalid payload reports field paths', async () => {
  const res = await withEnv(noNetwork, () => POST(post({ name: '', email: 'nope', details: '' })));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'validation');
});

test('oversized body is refused', async () => {
  const res = await withEnv(noNetwork, () => POST(post({ ...VALID, details: 'x'.repeat(20000) })));
  assert.equal(res.status, 413);
});

test('turnstile-config exposes only the public site key and action', async () => {
  const res = await withEnv(noNetwork, () => TURNSTILE_CONFIG());
  const json = await res.json();
  assert.equal(json.siteKey, ENV.TURNSTILE_SITE_KEY);
  assert.equal(JSON.stringify(json).includes(ENV.TURNSTILE_SECRET_KEY), false);
});
