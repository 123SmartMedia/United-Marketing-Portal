import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as LEGACY_REQUESTS } from '../src/app/api/requests/route.js';
import { POST as ADMIN_UPLOAD_URL } from '../src/app/api/admin/upload-url/route.js';
import { simpleSchema, requestSchema } from '../src/lib/requestSchema.js';

/**
 * Compatibility guard for everything the secure two-stage upload work did NOT
 * touch. These are the regressions that would be easy to cause and hard to
 * notice, because none of these surfaces is part of the wizard.
 *
 * Covered here:
 *   - /api/requests          (Get Started + category-page forms -> SendGrid)
 *   - /api/admin/upload-url  (admin CMS, authenticated, public asset bucket)
 *   - the shared schemas both the old and new flows parse with
 */

const ORIGIN = 'https://marketing.unitedmortgage.com';
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

function post(path, body, headers = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

async function withEnv(env, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// --- the inline forms -------------------------------------------------------

test('the Get Started / category-page form still submits through /api/requests', async () => {
  // No SENDGRID_API_KEY: deliverSubmission logs to the console and reports
  // delivered, which is the documented local/staging behavior.
  await withEnv({ SENDGRID_API_KEY: undefined }, async () => {
    const response = await LEGACY_REQUESTS(
      post('/api/requests', {
        source: 'get-started',
        requestType: 'Custom Request',
        name: 'Sam Officer',
        email: 'sofficer@unitedmortgage.com',
        phone: '631-555-0100',
        asset: 'Business Cards',
        details: 'Need 500 cards for a new hire.',
      })
    );
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
  });
});

test('/api/requests needs no Turnstile token and no finalize secret', async () => {
  // The inline forms have no Turnstile widget. Requiring one here would break
  // them silently, so this asserts the legacy path stayed independent.
  await withEnv(
    {
      SENDGRID_API_KEY: undefined,
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
      UPLOAD_FINALIZE_SECRET: undefined,
    },
    async () => {
      const response = await LEGACY_REQUESTS(
        post('/api/requests', {
          requestType: 'Custom Request',
          name: 'Sam',
          email: 'sam@unitedmortgage.com',
          details: 'Something small.',
        })
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
    }
  );
});

test('/api/requests still honours its honeypot', async () => {
  const response = await LEGACY_REQUESTS(
    post('/api/requests', { company: 'Bot Co', name: 'x', email: 'x@y.com', details: 'z' })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('/api/requests still rejects an invalid payload', async () => {
  const response = await LEGACY_REQUESTS(post('/api/requests', { name: '', email: 'nope', details: '' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'validation');
});

test('/api/requests still accepts a full wizard-shaped payload', async () => {
  // The email fallback path posts this shape, so it must keep parsing.
  await withEnv({ SENDGRID_API_KEY: undefined }, async () => {
    const response = await LEGACY_REQUESTS(
      post('/api/requests', {
        source: 'wizard',
        name: 'Jane Officer',
        email: 'jofficer@unitedmortgage.com',
        phone: '631-203-7480',
        nmls: '1234567',
        branch: 'Melville, NY',
        requestType: 'Custom / Other',
        dateNeeded: FUTURE,
        cobrand: 'No',
        projectTitle: 'Fall postcard',
        keyMessage: 'Book a valuation.',
        files: [],
      })
    );
    assert.equal(response.status, 200);
  });
});

// --- the admin CMS ----------------------------------------------------------

test('the admin upload endpoint is untouched and still requires authentication', async () => {
  // It presigns into the PUBLIC asset bucket and is a different route entirely
  // from the retired /api/upload-url. Retiring that one must not have reached it.
  const response = await ADMIN_UPLOAD_URL(
    post('/api/admin/upload-url', { filename: 'a.png', contentType: 'image/png', size: 100 })
  );
  assert.equal(response.status, 401);
  const json = await response.json();
  assert.equal(json.error, 'unauthorized');
  assert.equal(json.uploadUrl, undefined);
});

// --- shared schema ----------------------------------------------------------

test('the wizard schema accepts files both without a key (init) and with one (finalize)', () => {
  const base = {
    name: 'Jane', email: 'j@unitedmortgage.com', phone: '1', nmls: '2', branch: 'M',
    requestType: 'Custom / Other', dateNeeded: FUTURE, cobrand: 'No',
    projectTitle: 'T', keyMessage: 'K',
  };

  // Stage 1: the file has not been uploaded yet, so it has no key.
  const atInit = requestSchema.safeParse({
    ...base,
    files: [{ name: 'a.png', size: 10, type: 'image/png' }],
  });
  assert.equal(atInit.success, true, 'init-shaped files must parse');

  // Stage 2: the file echoes back the key it was uploaded under.
  const atFinalize = requestSchema.safeParse({
    ...base,
    files: [{ name: 'a.png', size: 10, type: 'image/png', key: 'marketing-requests/x/y' }],
  });
  assert.equal(atFinalize.success, true, 'finalize-shaped files must parse');
});

test('the simple schema used by the inline forms is unchanged', () => {
  const parsed = simpleSchema.safeParse({
    name: 'Sam',
    email: 'sam@unitedmortgage.com',
    details: 'Need something.',
  });
  assert.equal(parsed.success, true);
  // requestType defaults rather than being required, which is what keeps the
  // category-page CTA working without a type picker.
  assert.equal(parsed.data.requestType, 'Custom Request');
});

test('the upload limits re-exported from requestSchema match uploadRules', async () => {
  const schemaModule = await import('../src/lib/requestSchema.js');
  const rules = await import('../src/lib/uploadRules.js');
  assert.equal(schemaModule.MAX_FILES, rules.MAX_FILES);
  assert.equal(schemaModule.MAX_FILE_BYTES, rules.MAX_FILE_BYTES);
  assert.equal(schemaModule.MAX_TOTAL_BYTES, rules.MAX_TOTAL_BYTES);
  assert.deepEqual(schemaModule.ACCEPTED_UPLOAD_TYPES, rules.ACCEPTED_UPLOAD_TYPES);
});
