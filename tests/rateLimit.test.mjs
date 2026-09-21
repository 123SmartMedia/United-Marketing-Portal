import test from 'node:test';
import assert from 'node:assert/strict';

import { checkRateLimit, clientIp, isSameOrigin, __resetRateLimitState } from '../src/lib/rateLimit.js';
import { getIdempotencyStore, __resetIdempotencyStore } from '../src/lib/idempotencyStore.js';

const store = getIdempotencyStore();
const getIdempotentResult = (key) => store.get(key);
const rememberIdempotentResult = (key, value, opts) => store.remember(key, value, opts);
const claimInFlight = (key) => store.claim(key);
const releaseInFlight = (key) => store.release(key);

test.beforeEach(() => {
  __resetRateLimitState();
  __resetIdempotencyStore();
});

test('submissions are allowed up to the limit, then throttled', () => {
  const key = 'ip:1.2.3.4';
  for (let i = 0; i < 5; i += 1) {
    assert.equal(checkRateLimit(key, { max: 5, windowMs: 60000 }).allowed, true, `hit ${i + 1}`);
  }
  const blocked = checkRateLimit(key, { max: 5, windowMs: 60000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('throttling is per key, so one submitter cannot block another', () => {
  for (let i = 0; i < 5; i += 1) checkRateLimit('ip:a', { max: 5, windowMs: 60000 });
  assert.equal(checkRateLimit('ip:a', { max: 5, windowMs: 60000 }).allowed, false);
  assert.equal(checkRateLimit('ip:b', { max: 5, windowMs: 60000 }).allowed, true);
});

test('hits outside the window no longer count', async () => {
  assert.equal(checkRateLimit('ip:c', { max: 1, windowMs: 20 }).allowed, true);
  assert.equal(checkRateLimit('ip:c', { max: 1, windowMs: 20 }).allowed, false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(checkRateLimit('ip:c', { max: 1, windowMs: 20 }).allowed, true);
});

test('a repeated submission id returns the original result instead of creating another ticket', () => {
  const result = { ok: true, requestKey: 'MKT-123' };
  assert.equal(getIdempotentResult('sub-1'), null);
  rememberIdempotentResult('sub-1', result);
  assert.deepEqual(getIdempotentResult('sub-1'), result);
  assert.equal(getIdempotentResult('sub-2'), null);
});

test('a remembered result expires', async () => {
  rememberIdempotentResult('sub-x', { ok: true }, { ttlMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(getIdempotentResult('sub-x'), null);
});

test('a second concurrent click on the same submission is refused while the first is in flight', () => {
  assert.equal(claimInFlight('sub-9'), true);
  assert.equal(claimInFlight('sub-9'), false, 'duplicate click reached Jira');
  releaseInFlight('sub-9');
  assert.equal(claimInFlight('sub-9'), true);
});

test('a missing submission id never blocks the request', () => {
  assert.equal(claimInFlight(null), true);
  assert.equal(claimInFlight(null), true);
  assert.equal(getIdempotentResult(null), null);
  rememberIdempotentResult(null, { ok: true }); // no-op, must not throw
});

test('the client IP comes from the proxy headers, with a shared fallback', () => {
  const request = (headers) => ({ headers: new Headers(headers) });
  assert.equal(clientIp(request({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' })), '203.0.113.7');
  assert.equal(clientIp(request({ 'x-real-ip': '203.0.113.9' })), '203.0.113.9');
  assert.equal(clientIp(request({})), 'unknown');
});

test('the idempotency store advertises whether it is durable', () => {
  // The bundled store is per-process. Production should swap in a durable
  // adapter; this assertion documents the current, deliberate state.
  assert.equal(store.durable, false);
  assert.equal(store.name, 'memory');
});

test('cross-origin posts are refused, same-origin and header-less ones allowed', () => {
  const req = (headers) => ({
    url: 'https://marketing.unitedmortgage.com/api/jira/requests',
    headers: new Headers(headers),
  });
  assert.equal(isSameOrigin(req({ origin: 'https://marketing.unitedmortgage.com' })), true);
  assert.equal(isSameOrigin(req({ origin: 'https://evil.example.com' })), false);
  assert.equal(isSameOrigin(req({ referer: 'https://marketing.unitedmortgage.com/custom-requests' })), true);
  assert.equal(isSameOrigin(req({ origin: 'not-a-url' })), false);
  // Some browsers omit Origin on same-origin requests.
  assert.equal(isSameOrigin(req({})), true);
});
