import test from 'node:test';
import assert from 'node:assert/strict';

import { PATCH, DELETE } from '../src/app/api/admin/posts/route.js';
import { ADMIN_COOKIE, issueToken } from '../src/lib/adminAuth.js';

/**
 * PATCH /api/admin/posts gates. Every case here is rejected before storage is
 * touched, so no R2 client is created and nothing is written.
 */

const ORIGIN = 'https://marketing.unitedmortgage.com';
const SECRET = 'admin-test-secret-long-enough';

function withAdminEnv(fn) {
  const saved = { p: process.env.ADMIN_PASSWORD, s: process.env.ADMIN_SESSION_SECRET };
  process.env.ADMIN_PASSWORD = 'pw';
  process.env.ADMIN_SESSION_SECRET = SECRET;
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of [['ADMIN_PASSWORD', saved.p], ['ADMIN_SESSION_SECRET', saved.s]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function request(method, { query = '', body, authed = true, origin = ORIGIN } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.origin = origin;
  if (authed) headers.cookie = `${ADMIN_COOKIE}=${issueToken()}`;
  const req = new Request(`${ORIGIN}/api/admin/posts${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Next exposes parsed cookies on NextRequest; mirror that for plain Requests.
  req.cookies = { get: (name) => (authed && name === ADMIN_COOKIE ? { value: headers.cookie.split('=')[1] } : undefined) };
  return req;
}

test('PATCH without the admin cookie is 401', () =>
  withAdminEnv(async () => {
    const res = await PATCH(request('PATCH', { query: '?id=x', body: { title: 'New' }, authed: false }));
    assert.equal(res.status, 401);
  }));

test('PATCH from another origin is 403 even when signed in', () =>
  withAdminEnv(async () => {
    const res = await PATCH(request('PATCH', { query: '?id=x', body: { title: 'New' }, origin: 'https://evil.test' }));
    assert.equal(res.status, 403);
  }));

test('PATCH rejects fields that are not editable', () =>
  withAdminEnv(async () => {
    const res = await PATCH(request('PATCH', { query: '?id=x', body: { url: 'https://evil.test/x.png' } }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: 'unknown_field', field: 'url' });
  }));

test('PATCH rejects an empty title, bad category and non-boolean published', () =>
  withAdminEnv(async () => {
    const cases = [
      [{ title: '   ' }, 'missing_title'],
      [{ category: 'not-a-category' }, 'invalid_category'],
      [{ published: 'yes' }, 'invalid_published'],
      [{}, 'empty_patch'],
    ];
    for (const [body, error] of cases) {
      const res = await PATCH(request('PATCH', { query: '?id=x', body }));
      assert.equal(res.status, 400, error);
      assert.equal((await res.json()).error, error);
    }
  }));

test('reorder rejects a bad payload before storage', () =>
  withAdminEnv(async () => {
    const res = await PATCH(request('PATCH', { body: { reorder: { category: 'social-media', ids: [] } } }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_order');
  }));

test('DELETE from another origin is 403', () =>
  withAdminEnv(async () => {
    const res = await DELETE(request('DELETE', { query: '?id=x', origin: 'https://evil.test' }));
    assert.equal(res.status, 403);
  }));
