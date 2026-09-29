import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as ADMIN_UPLOAD_URL } from '../src/app/api/admin/upload-url/route.js';
import { simpleSchema, requestSchema } from '../src/lib/requestSchema.js';

/**
 * Compatibility guard for everything the secure two-stage upload work did NOT
 * touch. These are the regressions that would be easy to cause and hard to
 * notice, because none of these surfaces is part of the wizard.
 *
 * Covered here:
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

// --- the inline forms -------------------------------------------------------
// /api/requests is now Turnstile-gated and covered in tests/requestsRoute.test.mjs.

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
