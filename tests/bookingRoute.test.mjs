import test from 'node:test';
import assert from 'node:assert/strict';

import { GET, POST } from '../src/app/api/podcast-room/bookings/route.js';
import { POST as CANCEL } from '../src/app/api/podcast-room/bookings/cancel/route.js';
import { __resetRateLimitState } from '../src/lib/rateLimit.js';

/**
 * Gate tests for the booking endpoints. Every case here must be rejected before
 * any storage call, so no R2 client is ever created. Turnstile is mocked at the
 * network boundary with Cloudflare's published test secret.
 */

const ORIGIN = 'https://marketing.unitedmortgage.com';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FUTURE_WEEKDAY = (() => {
  const d = new Date(Date.now() + 7 * 86400000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

const ENV = {
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_EXPECTED_HOSTNAME: 'marketing.unitedmortgage.com',
  BOOKING_SECRET: 'test-secret-that-is-long-enough',
  BOOKING_ALLOWED_EMAIL_DOMAINS: undefined,
  R2_ACCOUNT_ID: undefined,
  R2_ACCESS_KEY_ID: undefined,
  R2_SECRET_ACCESS_KEY: undefined,
  R2_UPLOADS_BUCKET: undefined,
  R2_BUCKET: undefined,
};

const VALID = {
  date: FUTURE_WEEKDAY,
  start: '10:00',
  durationMinutes: 60,
  name: 'Jane Officer',
  email: 'jofficer@unitedmortgage.com',
  purpose: 'Episode 12',
  attendees: 2,
  turnstileToken: 'token',
};

function post(url, body, { origin = ORIGIN } = {}) {
  return new Request(`${ORIGIN}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { origin } : {}),
      'x-forwarded-for': `10.1.0.${Math.floor(Math.random() * 250) + 1}`,
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
  return new Response(JSON.stringify({ success: true, hostname: 'marketing.unitedmortgage.com', action: 'marketing_request' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

test.beforeEach(() => __resetRateLimitState());

test('rejects cross-origin bookings', async () => {
  const res = await withEnv(noNetwork, () => POST(post('/api/podcast-room/bookings', VALID, { origin: 'https://evil.test' })));
  assert.equal(res.status, 403);
});

test('honeypot is accepted silently and books nothing', async () => {
  const res = await withEnv(noNetwork, () => POST(post('/api/podcast-room/bookings', { ...VALID, company: 'bot' })));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).booking, null);
});

test('invalid form reports field paths only', async () => {
  const res = await withEnv(noNetwork, () => POST(post('/api/podcast-room/bookings', { ...VALID, purpose: '', attendees: 20 })));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.deepEqual(json.fields.sort(), ['attendees', 'purpose']);
});

test('non-United email is refused before Turnstile is called', async () => {
  const res = await withEnv(noNetwork, () => POST(post('/api/podcast-room/bookings', { ...VALID, email: 'someone@gmail.com' })));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'email_domain_not_allowed');
});

test('missing Turnstile token is refused', async () => {
  const res = await withEnv(noNetwork, () => POST(post('/api/podcast-room/bookings', { ...VALID, turnstileToken: '' })));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).resetChallenge, true);
});

test('without private storage the booking is refused with a clear message, not lost', async () => {
  const res = await withEnv(turnstilePasses, () => POST(post('/api/podcast-room/bookings', VALID)));
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /marketing@unitedmortgage\.com/);
});

test('storage in the PUBLIC asset bucket is treated as not configured', async () => {
  const res = await withEnv(
    turnstilePasses,
    () => POST(post('/api/podcast-room/bookings', VALID)),
    { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'public-assets' }
  );
  assert.equal(res.status, 503);
});

test('GET validates the month and never reaches storage when unconfigured', async () => {
  const bad = await withEnv(noNetwork, () => GET(new Request(`${ORIGIN}/api/podcast-room/bookings?month=2026-13`)));
  assert.equal(bad.status, 400);
  const unconfigured = await withEnv(noNetwork, () => GET(new Request(`${ORIGIN}/api/podcast-room/bookings?month=2026-10`)));
  assert.equal(unconfigured.status, 503);
});

test('cancel rejects a forged token', async () => {
  const res = await withEnv(noNetwork, () =>
    CANCEL(post('/api/podcast-room/bookings/cancel', { id: '11111111-1111-4111-8111-111111111111', date: FUTURE_WEEKDAY, token: 'x'.repeat(43) }))
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_link');
});
