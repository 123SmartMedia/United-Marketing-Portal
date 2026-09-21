import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  createFinalizeToken,
  verifyFinalizeToken,
  hashPayload,
  hashesMatch,
  canonicalize,
  isFinalizeConfigured,
  getFinalizeSecret,
  PRESIGN_TTL_SECONDS,
  FINALIZE_TOKEN_TTL_SECONDS,
} from '../src/lib/uploadToken.js';

/**
 * The finalize token is the only thing standing between `/init` (which redeems a
 * Turnstile token) and `/finalize` (which creates a Jira ticket and reads files
 * out of R2). Every test here is an attack the token is supposed to stop.
 *
 * The secret below is a throwaway generated for this file. It is not a
 * production value and grants nothing.
 */
const SECRET = 'test-only-finalize-secret-not-a-real-key-000000';
const env = { UPLOAD_FINALIZE_SECRET: SECRET };

const submission = {
  name: 'Jane Officer',
  email: 'jofficer@unitedmortgage.com',
  requestType: 'Business Cards',
  projectTitle: 'Q3 Farming Campaign',
  files: [{ name: 'logo.png', size: 2048, type: 'image/png' }],
};

function mint(over = {}) {
  const requestId = over.requestId || randomUUID();
  return createFinalizeToken(
    {
      requestId,
      idempotencyKey: 'submission-abcdef12',
      keys: over.keys || [`marketing-requests/${requestId}/${randomUUID()}`],
      payloadHash: over.payloadHash || hashPayload(submission, SECRET),
      ttlSeconds: over.ttlSeconds ?? FINALIZE_TOKEN_TTL_SECONDS,
    },
    env
  );
}

test('presigned URLs are capped at the contractual 300 seconds', () => {
  assert.ok(PRESIGN_TTL_SECONDS <= 300, `presign TTL was ${PRESIGN_TTL_SECONDS}s`);
});

test('a freshly minted token verifies and returns what was bound into it', () => {
  const requestId = randomUUID();
  const key = `marketing-requests/${requestId}/${randomUUID()}`;
  const token = mint({ requestId, keys: [key] });

  const result = verifyFinalizeToken(token, env);
  assert.equal(result.ok, true);
  assert.equal(result.payload.rid, requestId);
  assert.equal(result.payload.idem, 'submission-abcdef12');
  assert.deepEqual(result.payload.keys, [key]);
  assert.equal(result.payload.hash, hashPayload(submission, SECRET));
});

test('the token is opaque: it carries no submitted value in readable form', () => {
  const token = mint();
  // Someone who intercepts the token must not learn the submitter's identity.
  assert.ok(!token.includes('jofficer'));
  assert.ok(!token.includes('Jane'));
  assert.ok(!token.includes(SECRET));
  const decoded = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
  assert.ok(!decoded.includes('jofficer'), 'the payload segment leaked the email');
  assert.ok(!decoded.includes('Q3 Farming'), 'the payload segment leaked the project title');
});

test('a tampered signature is rejected', () => {
  const token = mint();
  const [version, payload, signature] = token.split('.');
  const flipped = Buffer.from(signature, 'base64url');
  flipped[0] ^= 0xff;
  const result = verifyFinalizeToken(`${version}.${payload}.${flipped.toString('base64url')}`, env);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_token');
});

test('a tampered payload is rejected even though the signature is well-formed', () => {
  const requestId = randomUUID();
  const token = mint({ requestId });
  const [version, payload, signature] = token.split('.');

  // Swap in an extra object key the issuer never authorized.
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  decoded.keys.push(`marketing-requests/${requestId}/${randomUUID()}`);
  const forged = Buffer.from(JSON.stringify(decoded)).toString('base64url');

  const result = verifyFinalizeToken(`${version}.${forged}.${signature}`, env);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_token');
});

test('a token signed with a different secret is rejected', () => {
  const token = createFinalizeToken(
    { requestId: randomUUID(), idempotencyKey: null, keys: [], payloadHash: 'x' },
    { UPLOAD_FINALIZE_SECRET: 'a-different-secret-that-is-long-enough-here' }
  );
  const result = verifyFinalizeToken(token, env);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_token');
});

test('an expired token is rejected', () => {
  const token = mint({ ttlSeconds: -1 });
  const result = verifyFinalizeToken(token, env);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'token_expired');
});

test('malformed tokens are rejected without throwing', () => {
  for (const bad of ['', 'not-a-token', 'v1.only-two', 'v2.a.b', null, undefined, 42, 'v1..', 'x'.repeat(9000)]) {
    const result = verifyFinalizeToken(bad, env);
    assert.equal(result.ok, false, `expected rejection for ${String(bad).slice(0, 20)}`);
  }
});

test('an unset secret leaves the flow unconfigured rather than signing with a default', () => {
  assert.equal(isFinalizeConfigured({}), false);
  assert.equal(getFinalizeSecret({}), '');
  const result = verifyFinalizeToken(mint(), {});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'finalize_secret_missing');
});

test('a short secret is refused so a placeholder can never be used as a signing key', () => {
  assert.equal(isFinalizeConfigured({ UPLOAD_FINALIZE_SECRET: 'changeme' }), false);
  assert.equal(isFinalizeConfigured({ UPLOAD_FINALIZE_SECRET: 'x'.repeat(31) }), false);
  assert.equal(isFinalizeConfigured({ UPLOAD_FINALIZE_SECRET: 'x'.repeat(32) }), true);
});

test('the payload hash changes when any bound form field changes', () => {
  const base = hashPayload(submission, SECRET);
  assert.notEqual(hashPayload({ ...submission, email: 'someone.else@unitedmortgage.com' }, SECRET), base);
  assert.notEqual(hashPayload({ ...submission, projectTitle: 'Different' }, SECRET), base);
  assert.notEqual(
    hashPayload({ ...submission, files: [{ name: 'logo.png', size: 4096, type: 'image/png' }] }, SECRET),
    base,
    'a changed file size must change the hash'
  );
  assert.notEqual(
    hashPayload({ ...submission, files: [{ name: 'other.png', size: 2048, type: 'image/png' }] }, SECRET),
    base,
    'a changed filename must change the hash'
  );
});

test('the payload hash ignores key order but not values', () => {
  const a = hashPayload({ name: 'A', email: 'b@c.com', files: [] }, SECRET);
  const b = hashPayload({ email: 'b@c.com', name: 'A', files: [] }, SECRET);
  assert.equal(a, b, 're-serializing the same form must not change the hash');
});

test('the payload hash excludes the spent Turnstile token, the honeypot and the object keys', () => {
  const base = hashPayload(submission, SECRET);
  // The token is single-use and absent at finalize; the keys are bound separately
  // and more strictly. Including either would make a valid submission fail.
  assert.equal(hashPayload({ ...submission, turnstileToken: 'abc' }, SECRET), base);
  assert.equal(hashPayload({ ...submission, company: '' }, SECRET), base);
  assert.equal(
    hashPayload({ ...submission, files: [{ name: 'logo.png', size: 2048, type: 'image/png', key: 'marketing-requests/x/y' }] }, SECRET),
    base
  );
});

test('the payload hash is keyed, so it cannot be recomputed without the secret', () => {
  assert.notEqual(hashPayload(submission, SECRET), hashPayload(submission, 'another-secret'));
});

test('hashesMatch is value-based and rejects non-strings', () => {
  assert.equal(hashesMatch('abc', 'abc'), true);
  assert.equal(hashesMatch('abc', 'abd'), false);
  assert.equal(hashesMatch('abc', 'abcd'), false);
  assert.equal(hashesMatch(null, 'abc'), false);
  assert.equal(hashesMatch(undefined, undefined), false);
});

test('canonicalize sorts keys at every depth', () => {
  assert.equal(
    canonicalize({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
    canonicalize({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 })
  );
});

test('bound keys are sorted so upload order cannot change the token', () => {
  const requestId = randomUUID();
  const k1 = `marketing-requests/${requestId}/00000000-0000-4000-8000-000000000001`;
  const k2 = `marketing-requests/${requestId}/00000000-0000-4000-8000-000000000002`;
  const hash = hashPayload(submission, SECRET);
  const a = verifyFinalizeToken(mint({ requestId, keys: [k1, k2], payloadHash: hash }), env);
  const b = verifyFinalizeToken(mint({ requestId, keys: [k2, k1], payloadHash: hash }), env);
  assert.deepEqual(a.payload.keys, b.payload.keys);
});
