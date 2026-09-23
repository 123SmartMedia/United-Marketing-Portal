import test from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';

import { POST as INIT } from '../src/app/api/jira/requests/init/route.js';
import { POST as FINALIZE } from '../src/app/api/jira/requests/finalize/route.js';
import { POST as RETIRED_UPLOAD_URL } from '../src/app/api/upload-url/route.js';
import { __resetRateLimitState } from '../src/lib/rateLimit.js';
import { __resetIdempotencyStore } from '../src/lib/idempotencyStore.js';

/**
 * The two-stage submission flow, end to end, with every external boundary
 * mocked: Cloudflare siteverify and Jira via `globalThis.fetch`, and R2 via
 * `S3Client.prototype.send`.
 *
 * No live siteverify call, no live Jira call, no live R2 call, and no ticket is
 * ever created. `getSignedUrl` is left real because presigning is pure local
 * signing — it touches no network.
 *
 * Every key and secret below is a throwaway test value or one of Cloudflare's
 * published dummy keys. None is a production credential.
 */

const ORIGIN = 'https://marketing.unitedmortgage.com';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

const ENV = {
  JIRA_AUTH_MODE: 'scoped_token',
  JIRA_SITE_URL: 'https://example.atlassian.net',
  JIRA_BASE_URL: undefined,
  JIRA_CLOUD_ID: 'cloud-id-1234',
  JIRA_API_TOKEN: 'jira-token-placeholder',
  JIRA_SERVICE_DESK_ID: '68',
  JIRA_REQUEST_TYPE_ID: '123',
  JIRA_REQUEST_TYPE_PRINT: '117',
  JIRA_REQUEST_TYPE_DIGITAL: '116',
  JIRA_FIELD_DATE_NEEDED: 'customfield_10301',
  JIRA_ACK_EMAIL: 'false',
  JIRA_EMAIL_FALLBACK: 'false',
  JIRA_ATTACHMENTS_ENABLED: 'true',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA', // Cloudflare "always passes"
  TURNSTILE_EXPECTED_HOSTNAME: 'marketing.unitedmortgage.com',
  TURNSTILE_EXPECTED_ACTION: 'marketing_request',
  TURNSTILE_ACTION: undefined,
  ALLOWED_REQUEST_EMAIL_DOMAINS: 'unitedmortgage.com',
  UPLOAD_FINALIZE_SECRET: 'test-only-finalize-secret-not-a-real-key-000000',
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_UPLOADS_BUCKET: 'umc-request-uploads-test',
  R2_BUCKET: 'umc-public-assets-test',
};

const BASE_FORM = {
  source: 'wizard',
  name: 'Jane Officer',
  email: 'jofficer@unitedmortgage.com',
  phone: '631-203-7480',
  nmls: '1234567',
  branch: 'Melville, NY',
  requestType: 'Custom / Other',
  dateNeeded: FUTURE,
  rush: false,
  cobrand: 'No',
  projectTitle: 'Fall farming postcard',
  keyMessage: 'Book a free valuation.',
  files: [],
};

const PNG_FILE = { name: 'logo.png', size: 8, type: 'image/png' };
/** Real magic bytes, so the content-sniffing check in attachments.js passes. */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_BYTES = Buffer.from('%PDF-1.4');

const bytesFor = (type) => (type === 'application/pdf' ? PDF_BYTES : PNG_BYTES);

// --- network mocks ----------------------------------------------------------

const turnstilePasses = () =>
  new Response(
    JSON.stringify({
      success: true,
      hostname: 'marketing.unitedmortgage.com',
      action: 'marketing_request',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

const turnstileFails = (codes = ['invalid-input-response']) =>
  new Response(JSON.stringify({ success: false, 'error-codes': codes }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

function mockNetwork({ turnstile, jira } = {}) {
  return async (url, init) => {
    const href = String(url);
    if (href === SITEVERIFY) {
      if (!turnstile) throw new Error('siteverify must not be called');
      return turnstile(new URLSearchParams(init.body));
    }
    if (!jira) throw new Error(`no external call expected (${href})`);
    return jira(href, init);
  };
}

const jiraCreated = (key = 'MKT-900') =>
  new Response(
    JSON.stringify({
      issueKey: key,
      _links: { web: `https://example.atlassian.net/servicedesk/customer/portal/68/${key}` },
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );

/** Jira that creates the request, accepts the temp file, and attaches it. */
function jiraHappyPath(log = {}) {
  return (href) => {
    if (href.endsWith('/rest/servicedeskapi/request')) {
      log.created = (log.created || 0) + 1;
      return jiraCreated();
    }
    if (href.includes('attachTemporaryFile')) {
      return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 'tmp-1' }] }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (href.includes('/attachment')) {
      log.attached = (log.attached || 0) + 1;
      return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected Jira call ${href}`);
  };
}

// --- R2 mock ----------------------------------------------------------------

/**
 * Patch the S3 client's send(). Returns a log of what the routes did to R2, so a
 * test can assert on cleanup without reaching a real bucket.
 */
function mockR2({ head, body, headThrows, byKey } = {}) {
  // `byKey` maps an object key to { ContentLength, ContentType, bytes } so a
  // multi-file test can give each file its real stored type. Without it, every
  // object answers as an 8-byte PNG.
  const log = { heads: [], deletes: [], gets: [], byKey: byKey || null };
  // Read log.byKey lazily: the keys only exist after init has run, so a test
  // fills it in between the two stages.
  const defaultHead = (key) => log.byKey?.[key] || { ContentLength: 8, ContentType: 'image/png' };
  const resolveHead = head || defaultHead;
  const resolveBody = (key) => log.byKey?.[key]?.bytes || body || PNG_BYTES;
  const original = S3Client.prototype.send;

  S3Client.prototype.send = async function send(command) {
    const name = command?.constructor?.name || '';
    const key = command?.input?.Key;

    if (name === 'HeadObjectCommand') {
      log.heads.push(key);
      if (headThrows) {
        const err = new Error('not found');
        err.name = headThrows;
        throw err;
      }
      return resolveHead(key);
    }
    if (name === 'GetObjectCommand') {
      log.gets.push(key);
      const bytes = resolveBody(key);
      return { ContentLength: bytes.length, Body: { transformToByteArray: async () => bytes } };
    }
    if (name === 'DeleteObjectCommand') {
      log.deletes.push(key);
      return {};
    }
    throw new Error(`unexpected S3 command ${name}`);
  };

  log.restore = () => {
    S3Client.prototype.send = original;
  };
  return log;
}

// --- harness ----------------------------------------------------------------

function post(path, body, { origin = ORIGIN, headers = {} } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { origin } : {}),
      'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function withEnv(fetchImpl, fn, envOverrides = {}) {
  const saved = {};
  const env = { ...ENV, ...envOverrides };
  for (const [key, value] of Object.entries(env)) {
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

/** Run init and return its parsed JSON. */
async function runInit(body, opts) {
  const response = await INIT(post('/api/jira/requests/init', body, opts));
  return { response, json: await response.json() };
}

test.beforeEach(() => {
  __resetRateLimitState();
  __resetIdempotencyStore();
});

// ============================================================================
// Turnstile gating of upload URLs
// ============================================================================

test('a valid submission with a file gets presigned PUTs and a finalize token', async () => {
  await withEnv(mockNetwork({ turnstile: turnstilePasses }), async () => {
    const { response, json } = await runInit({
      ...BASE_FORM,
      files: [PNG_FILE],
      submissionId: 'sub-init-ok',
      turnstileToken: 'token',
    });

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.uploads.length, 1);
    assert.match(json.uploads[0].key, /^marketing-requests\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    assert.ok(json.finalizeToken);
    assert.ok(json.uploadExpiresInSeconds <= 300, 'presigned URLs must expire within 300s');
  });
});

test('NO upload URL is issued when the Turnstile token fails', async () => {
  await withEnv(mockNetwork({ turnstile: () => turnstileFails() }), async () => {
    const { response, json } = await runInit({
      ...BASE_FORM,
      files: [PNG_FILE],
      submissionId: 'sub-ts-fail',
      turnstileToken: 'bad',
    });

    assert.equal(response.status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.resetChallenge, true, 'the client must be told to re-mint a token');
    assert.equal(json.uploads, undefined, 'no upload plan may be returned');
    assert.equal(json.finalizeToken, undefined, 'no finalize token may be returned');
  });
});

test('NO upload URL is issued when the Turnstile token is missing', async () => {
  // siteverify must not even be called: a missing token is rejected locally.
  await withEnv(mockNetwork({}), async () => {
    const { response, json } = await runInit({ ...BASE_FORM, files: [PNG_FILE], submissionId: 'sub-ts-missing' });
    assert.equal(response.status, 400);
    assert.equal(json.error, 'turnstile_missing');
    assert.equal(json.uploads, undefined);
  });
});

test('a duplicate or expired token is rejected and no upload URL is issued', async () => {
  await withEnv(mockNetwork({ turnstile: () => turnstileFails(['timeout-or-duplicate']) }), async () => {
    const { response, json } = await runInit({
      ...BASE_FORM,
      files: [PNG_FILE],
      submissionId: 'sub-dupe',
      turnstileToken: 'spent',
    });
    assert.equal(response.status, 400);
    assert.equal(json.error, 'turnstile_duplicate');
    assert.equal(json.uploads, undefined);
  });
});

test('a hostname mismatch is rejected and no upload URL is issued', async () => {
  const wrongHost = () =>
    new Response(JSON.stringify({ success: true, hostname: 'evil.example.com', action: 'marketing_request' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  await withEnv(mockNetwork({ turnstile: wrongHost }), async () => {
    const { response, json } = await runInit({
      ...BASE_FORM,
      files: [PNG_FILE],
      submissionId: 'sub-host',
      turnstileToken: 'token',
    });
    assert.equal(response.status, 400);
    assert.equal(json.error, 'turnstile_hostname_mismatch');
    assert.equal(json.uploads, undefined);
  });
});

test('an action mismatch is rejected and no upload URL is issued', async () => {
  const wrongAction = () =>
    new Response(
      JSON.stringify({ success: true, hostname: 'marketing.unitedmortgage.com', action: 'some_other_form' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  await withEnv(mockNetwork({ turnstile: wrongAction }), async () => {
    const { response, json } = await runInit({
      ...BASE_FORM,
      files: [PNG_FILE],
      submissionId: 'sub-action',
      turnstileToken: 'token',
    });
    assert.equal(response.status, 400);
    assert.equal(json.error, 'turnstile_action_mismatch');
    assert.equal(json.uploads, undefined);
  });
});

test('a siteverify timeout is reported as unavailable and issues no upload URL', async () => {
  const timeout = () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    throw err;
  };
  await withEnv(mockNetwork({ turnstile: timeout }), async () => {
    const { response, json } = await runInit({
      ...BASE_FORM,
      files: [PNG_FILE],
      submissionId: 'sub-timeout',
      turnstileToken: 'token',
    });
    assert.equal(response.status, 503);
    assert.equal(json.error, 'turnstile_timeout');
    assert.equal(json.uploads, undefined);
  });
});

test('the honeypot mints nothing at all', async () => {
  // siteverify must not be called — we do not spend a verification on a bot.
  await withEnv(mockNetwork({}), async () => {
    const { response, json } = await runInit({
      ...BASE_FORM,
      files: [PNG_FILE],
      company: 'Bot Co',
      turnstileToken: 'token',
    });
    assert.equal(response.status, 200);
    assert.equal(json.ok, true, 'a bot should not learn it was caught');
    assert.equal(json.finalizeToken, null);
    assert.deepEqual(json.uploads, []);
  });
});

test('invalid form data is rejected before siteverify is called', async () => {
  await withEnv(mockNetwork({}), async () => {
    const { response, json } = await runInit({
      ...BASE_FORM,
      email: 'not-an-email',
      turnstileToken: 'token',
    });
    assert.equal(response.status, 400);
    assert.ok(json.fields.includes('email'));
  });
});

test('a disallowed email domain is rejected before siteverify is called', async () => {
  await withEnv(mockNetwork({}), async () => {
    const { response, json } = await runInit({
      ...BASE_FORM,
      email: 'someone@gmail.com',
      turnstileToken: 'token',
    });
    assert.equal(response.status, 403);
    assert.equal(json.error, 'email_domain_not_allowed');
  });
});

test('an invalid file is rejected before siteverify is called and before any key exists', async () => {
  for (const bad of [
    { name: 'evil.exe', size: 10, type: 'image/png' },
    { name: 'big.png', size: 11 * 1024 * 1024, type: 'image/png' },
    { name: 'empty.png', size: 0, type: 'image/png' },
    { name: 'sneak.exe.pdf', size: 10, type: 'application/pdf' },
    { name: 'archive.zip', size: 10, type: 'application/zip' },
  ]) {
    await withEnv(mockNetwork({}), async () => {
      const { response, json } = await runInit({ ...BASE_FORM, files: [bad], turnstileToken: 'token' });
      assert.equal(response.status, 400, `${bad.name} was not rejected`);
      assert.equal(json.uploads, undefined);
    });
    __resetRateLimitState();
  }
});

test('the retired /api/upload-url endpoint no longer issues anything', async () => {
  const response = await RETIRED_UPLOAD_URL(post('/api/upload-url', { contentType: 'image/png', size: 10 }));
  const json = await response.json();
  assert.equal(response.status, 410);
  assert.equal(json.ok, false);
  assert.equal(json.uploadUrl, undefined, 'the retired route must never return an upload URL');
  assert.equal(json.key, undefined);
});

// ============================================================================
// Finalize
// ============================================================================

/** Run init, then hand the result to finalize with optional tampering. */
async function initThenFinalize({ files = [PNG_FILE], tamper = (x) => x, jira, r2, submissionId = 'sub-flow' }) {
  const r2Log = mockR2(r2 || {});
  try {
    return await withEnv(mockNetwork({ turnstile: turnstilePasses, jira }), async () => {
      const { json: init } = await runInit({ ...BASE_FORM, files, submissionId, turnstileToken: 'token' });
      assert.ok(init.ok, `init failed: ${init.error}`);

      const uploaded = init.uploads.map((u) => ({ ...files[u.index], key: u.key }));
      // Now that the keys exist, tell the R2 mock what each object really holds.
      if (r2?.perFile) {
        r2Log.byKey = {};
        for (const u of init.uploads) {
          r2Log.byKey[u.key] = r2.perFile(files[u.index]);
        }
      }
      const payload = tamper({
        ...BASE_FORM,
        files: uploaded,
        finalizeToken: init.finalizeToken,
      });

      const response = await FINALIZE(post('/api/jira/requests/finalize', payload));
      return { response, json: await response.json(), init, r2Log };
    });
  } finally {
    r2Log.restore();
  }
}

test('the full two-stage flow creates one ticket, attaches the file, and deletes the object', async () => {
  const log = {};
  const { response, json, r2Log } = await initThenFinalize({ jira: jiraHappyPath(log), submissionId: 'sub-full' });

  assert.equal(response.status, 201);
  assert.equal(json.ok, true);
  assert.equal(json.requestKey, 'MKT-900');
  assert.equal(log.created, 1, 'exactly one Jira request');
  assert.equal(log.attached, 1);
  assert.deepEqual(json.attachments, { total: 1, attached: 1, failed: 0, warning: null });

  // HeadObject verified it, GetObject read it, DeleteObject cleaned it up.
  assert.equal(r2Log.heads.length, 1);
  assert.equal(r2Log.gets.length, 1);
  assert.equal(r2Log.deletes.length, 1, 'the staged object must be deleted after a successful attach');
  assert.equal(r2Log.deletes[0], r2Log.heads[0]);
});

test('a tampered finalize token is rejected', async () => {
  const { response, json } = await initThenFinalize({
    jira: () => {
      throw new Error('Jira must not be called');
    },
    tamper: (p) => {
      const [v, payload, sig] = p.finalizeToken.split('.');
      const flipped = Buffer.from(sig, 'base64url');
      flipped[0] ^= 0xff;
      return { ...p, finalizeToken: `${v}.${payload}.${flipped.toString('base64url')}` };
    },
  });
  assert.equal(response.status, 400);
  assert.equal(json.error, 'invalid_submission');
});

test('a missing finalize token is rejected', async () => {
  const { response, json } = await initThenFinalize({
    jira: () => {
      throw new Error('Jira must not be called');
    },
    tamper: (p) => ({ ...p, finalizeToken: undefined }),
  });
  assert.equal(response.status, 400);
  assert.equal(json.error, 'invalid_submission');
});

test('an edited form payload is rejected by the bound hash', async () => {
  const { response, json } = await initThenFinalize({
    jira: () => {
      throw new Error('Jira must not be called');
    },
    // The token was minted for a different project title.
    tamper: (p) => ({ ...p, projectTitle: 'Something else entirely' }),
  });
  assert.equal(response.status, 400);
  assert.equal(json.error, 'invalid_submission');
});

test('an edited file size is rejected by the bound hash', async () => {
  const { response, json } = await initThenFinalize({
    jira: () => {
      throw new Error('Jira must not be called');
    },
    tamper: (p) => ({ ...p, files: p.files.map((f) => ({ ...f, size: 4096 })) }),
  });
  assert.equal(response.status, 400);
  assert.equal(json.error, 'invalid_submission');
});

test('an object key the token never authorized is rejected', async () => {
  const { response, json } = await initThenFinalize({
    jira: () => {
      throw new Error('Jira must not be called');
    },
    tamper: (p) => ({
      ...p,
      files: p.files.map((f) => ({
        ...f,
        // Well-formed, but belongs to a different request.
        key: 'marketing-requests/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
      })),
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(json.error, 'invalid_submission');
});

test('a traversal-style object key is rejected', async () => {
  const { response, json } = await initThenFinalize({
    jira: () => {
      throw new Error('Jira must not be called');
    },
    tamper: (p) => ({ ...p, files: p.files.map((f) => ({ ...f, key: '../../public-assets/logo.png' })) }),
  });
  assert.equal(response.status, 400);
  assert.equal(json.error, 'invalid_submission');
});

test('an expired finalize token is rejected', async () => {
  // Mint a token that is already past its expiry, independent of init.
  const { createFinalizeToken, hashPayload } = await import('../src/lib/uploadToken.js');
  const secret = ENV.UPLOAD_FINALIZE_SECRET;
  const token = createFinalizeToken(
    {
      requestId: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'sub-expired',
      keys: [],
      payloadHash: hashPayload({ ...BASE_FORM, files: [] }, secret),
      ttlSeconds: -1,
    },
    { UPLOAD_FINALIZE_SECRET: secret }
  );

  await withEnv(mockNetwork({}), async () => {
    const response = await FINALIZE(post('/api/jira/requests/finalize', { ...BASE_FORM, finalizeToken: token }));
    const json = await response.json();
    assert.equal(response.status, 400);
    assert.equal(json.error, 'invalid_submission');
  });
});

// --- HeadObject verification ------------------------------------------------

test('a never-uploaded object is caught by HeadObject and nothing reaches Jira', async () => {
  const { response, json } = await initThenFinalize({
    jira: () => {
      throw new Error('Jira must not be called');
    },
    r2: { headThrows: 'NotFound' },
  });
  assert.equal(response.status, 400);
  assert.equal(json.error, 'upload_missing');
});

test('an object whose real size differs from the declared size is rejected and purged', async () => {
  const { response, json, r2Log } = await initThenFinalize({
    jira: () => {
      throw new Error('Jira must not be called');
    },
    // Declared 8 bytes; R2 actually holds 5MB.
    r2: { head: () => ({ ContentLength: 5 * 1024 * 1024, ContentType: 'image/png' }) },
  });
  assert.equal(response.status, 400);
  assert.equal(json.error, 'upload_size_mismatch');
  assert.equal(r2Log.deletes.length, 1, 'the mismatched object must be deleted');
});

test('an object whose stored content type differs is rejected and purged', async () => {
  const { response, json, r2Log } = await initThenFinalize({
    jira: () => {
      throw new Error('Jira must not be called');
    },
    r2: { head: () => ({ ContentLength: 8, ContentType: 'application/x-msdownload' }) },
  });
  assert.equal(response.status, 400);
  assert.equal(json.error, 'upload_type_mismatch');
  assert.equal(r2Log.deletes.length, 1);
});

test('a charset suffix on the stored content type is tolerated', async () => {
  const log = {};
  const { response } = await initThenFinalize({
    jira: jiraHappyPath(log),
    r2: { head: () => ({ ContentLength: 8, ContentType: 'image/png; charset=binary' }) },
    submissionId: 'sub-charset',
  });
  assert.equal(response.status, 201);
});

// --- cleanup ----------------------------------------------------------------

test('every staged object is deleted when Jira request creation fails', async () => {
  const { response, json, r2Log } = await initThenFinalize({
    files: [PNG_FILE, { name: 'flyer.pdf', size: 8, type: 'application/pdf' }],
    jira: (href) => {
      if (href.endsWith('/rest/servicedeskapi/request')) {
        return new Response(JSON.stringify({ errorMessages: ['nope'] }), { status: 500 });
      }
      throw new Error('nothing else should be called after creation fails');
    },
    submissionId: 'sub-create-fail',
  });

  assert.equal(json.ok, false);
  assert.ok(response.status >= 400);
  assert.equal(r2Log.deletes.length, 2, 'both staged objects must be deleted');
});

test('an object Jira never accepted is LEFT for the lifecycle rule, not deleted', async () => {
  const { response, json, r2Log } = await initThenFinalize({
    jira: (href) => {
      if (href.endsWith('/rest/servicedeskapi/request')) return jiraCreated('MKT-901');
      // Every attachment attempt fails.
      return new Response(JSON.stringify({ errorMessages: ['attach failed'] }), { status: 500 });
    },
    submissionId: 'sub-attach-fail',
  });

  // The ticket exists, so the submission succeeded...
  assert.equal(response.status, 201);
  assert.equal(json.requestKey, 'MKT-901');
  // ...but the response says honestly that nothing landed.
  assert.equal(json.attachments.attached, 0);
  assert.equal(json.attachments.failed, 1);
  // The object stays private until the lifecycle rule expires it, keeping a
  // manual retry window open.
  assert.equal(r2Log.deletes.length, 0, 'a failed attachment must not be deleted immediately');
});

test('a failed attachment is retried a bounded number of times', async () => {
  let attempts = 0;
  const { r2Log } = await initThenFinalize({
    jira: (href) => {
      if (href.endsWith('/rest/servicedeskapi/request')) return jiraCreated('MKT-902');
      if (href.includes('attachTemporaryFile')) {
        attempts += 1;
        return new Response(JSON.stringify({ errorMessages: ['boom'] }), { status: 500 });
      }
      throw new Error('should not reach permanent attach');
    },
    submissionId: 'sub-retry',
  });

  assert.ok(attempts > 1, 'the attachment must be retried');
  assert.ok(attempts <= 3, `retries must be bounded, saw ${attempts}`);
  assert.equal(r2Log.deletes.length, 0);
});

test('a partial attachment failure reports honestly and does not lose the ticket', async () => {
  let tempCalls = 0;
  const { response, json } = await initThenFinalize({
    files: [PNG_FILE, { name: 'flyer.pdf', size: 8, type: 'application/pdf' }],
    jira: (href) => {
      if (href.endsWith('/rest/servicedeskapi/request')) return jiraCreated('MKT-903');
      if (href.includes('attachTemporaryFile')) {
        tempCalls += 1;
        // The first file uploads; the second is refused.
        if (tempCalls === 1) {
          return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 'tmp-1' }] }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ errorMessages: ['refused'] }), { status: 400 });
      }
      return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } });
    },
    // Each object must report its own real stored type, or the PDF would be
    // rejected at the HeadObject check before Jira is ever reached.
    r2: { perFile: (file) => ({ ContentLength: file.size, ContentType: file.type, bytes: bytesFor(file.type) }) },
    submissionId: 'sub-partial',
  });

  assert.equal(response.status, 201);
  assert.equal(json.attachments.total, 2);
  assert.equal(json.attachments.attached, 1);
  assert.equal(json.attachments.failed, 1);
  assert.equal(json.attachments.warning, 'attachment_partial_failure');
});

// --- leakage ----------------------------------------------------------------

test('no response from either stage leaks an R2 URL, bucket, account id or credential', async () => {
  const log = {};
  const { json, init } = await initThenFinalize({ jira: jiraHappyPath(log), submissionId: 'sub-leak' });

  const finalizeBody = JSON.stringify(json);
  for (const forbidden of [
    'r2.cloudflarestorage.com',
    ENV.R2_UPLOADS_BUCKET,
    ENV.R2_BUCKET,
    ENV.R2_ACCOUNT_ID,
    ENV.R2_ACCESS_KEY_ID,
    ENV.R2_SECRET_ACCESS_KEY,
    ENV.UPLOAD_FINALIZE_SECRET,
    ENV.JIRA_API_TOKEN,
    ENV.TURNSTILE_SECRET_KEY,
    'X-Amz-Signature',
    'marketing-requests/',
  ]) {
    assert.ok(!finalizeBody.includes(forbidden), `finalize response leaked "${forbidden}"`);
  }

  // Init necessarily returns presigned PUT URLs — that is its job — but it must
  // not return anything readable, nor any credential beyond the PUT signature.
  const initBody = JSON.stringify(init);
  for (const forbidden of [
    ENV.R2_SECRET_ACCESS_KEY,
    ENV.UPLOAD_FINALIZE_SECRET,
    ENV.JIRA_API_TOKEN,
    ENV.TURNSTILE_SECRET_KEY,
  ]) {
    assert.ok(!initBody.includes(forbidden), `init response leaked "${forbidden}"`);
  }
  // A presigned PUT is not a readable URL: it carries an explicit PUT signature
  // and expires in five minutes.
  assert.ok(init.uploads[0].uploadUrl.includes('X-Amz-Expires=300'));
});

test('no R2 object key or URL is ever written into the Jira description', async () => {
  let createdBody = null;
  await initThenFinalize({
    jira: (href, init) => {
      if (href.endsWith('/rest/servicedeskapi/request')) {
        createdBody = JSON.parse(init.body);
        return jiraCreated('MKT-904');
      }
      if (href.includes('attachTemporaryFile')) {
        return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 't' }] }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } });
    },
    submissionId: 'sub-desc',
  });

  const description = createdBody.requestFieldValues.description;
  assert.ok(!description.includes('marketing-requests/'), 'an object key leaked into the description');
  assert.ok(!description.includes('r2.cloudflarestorage'), 'a storage host leaked into the description');
  assert.ok(!description.includes('http'), 'a URL leaked into the description');
  // The filename still appears, so the desk knows what was meant to arrive.
  assert.match(description, /logo\.png/);
});

// --- configuration ----------------------------------------------------------

test('an unset UPLOAD_FINALIZE_SECRET blocks the flow instead of signing with a default', async () => {
  await withEnv(
    mockNetwork({ turnstile: turnstilePasses }),
    async () => {
      const { response, json } = await runInit({
        ...BASE_FORM,
        files: [PNG_FILE],
        submissionId: 'sub-nosecret',
        turnstileToken: 'token',
      });
      assert.equal(response.status, 503);
      assert.equal(json.error, 'uploads_not_configured');
      assert.equal(json.finalizeToken, undefined);
    },
    { UPLOAD_FINALIZE_SECRET: undefined }
  );
});

test('a cross-origin post is refused by both stages', async () => {
  const a = await INIT(post('/api/jira/requests/init', BASE_FORM, { origin: 'https://evil.example.com' }));
  assert.equal(a.status, 403);
  const b = await FINALIZE(post('/api/jira/requests/finalize', BASE_FORM, { origin: 'https://evil.example.com' }));
  assert.equal(b.status, 403);
});

test('rate limiting still applies to the init stage', async () => {
  await withEnv(mockNetwork({ turnstile: turnstilePasses }), async () => {
    const ip = '10.9.9.9';
    let last;
    for (let i = 0; i < 12; i += 1) {
      last = await INIT(
        post(
          '/api/jira/requests/init',
          { ...BASE_FORM, submissionId: `sub-rl-${i}`, turnstileToken: 'token' },
          { headers: { 'x-forwarded-for': ip } }
        )
      );
    }
    assert.equal(last.status, 429);
  });
});

// ============================================================================
// Category routing and the structured requested date
// ============================================================================

/** Run the full two-stage flow and return the body Jira was asked to create. */
async function capturedCreateBody(overrides = {}, envOverrides = {}) {
  let created = null;
  const r2Log = mockR2({});
  try {
    return await withEnv(
      mockNetwork({
        turnstile: turnstilePasses,
        jira: (href, init) => {
          if (href.endsWith('/rest/servicedeskapi/request')) {
            created = JSON.parse(init.body);
            return jiraCreated('MKT-777');
          }
          if (href.includes('attachTemporaryFile')) {
            return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 't' }] }), {
              status: 201, headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } });
        },
      }),
      async () => {
        const { json: init } = await runInit({
          ...BASE_FORM, ...overrides, files: [], submissionId: `sub-${Math.random().toString(36).slice(2, 10)}`,
          turnstileToken: 'token',
        });
        assert.ok(init.ok, `init failed: ${init.error}`);
        const response = await FINALIZE(post('/api/jira/requests/finalize', {
          ...BASE_FORM, ...overrides, files: [], finalizeToken: init.finalizeToken,
        }));
        return { response, json: await response.json(), created };
      },
      envOverrides
    );
  } finally {
    r2Log.restore();
  }
}

for (const [category, expected] of [
  ['Business Cards', '117'],
  ['Letterhead / Stationery', '117'],
  ['Co-branded Flyer / Folder', '117'],
  ['Print Order (Banner, Yard Sign, Door Hanger)', '117'],
  ['Digital Asset Creation', '116'],
  ['Custom / Other', '123'],
]) {
  test(`"${category}" reaches Jira as request type ${expected}`, async () => {
    // The print categories open a Step 2 that requires printingNeeded.
    const extra = /Business Cards|Letterhead|Print Order/.test(category) ? { printingNeeded: 'No' } : {};
    const { response, created } = await capturedCreateBody({ requestType: category, ...extra });
    assert.equal(response.status, 201);
    assert.equal(created.requestTypeId, expected);
    assert.equal(created.serviceDeskId, '68');
  });
}

test('the selected website category still appears in the Jira description', async () => {
  const { created } = await capturedCreateBody({
    requestType: 'Business Cards',
    printingNeeded: 'No',
  });
  assert.match(created.requestFieldValues.description, /Request type: Business Cards/);
});

test('missing routing configuration sends the default request type', async () => {
  const { created } = await capturedCreateBody(
    { requestType: 'Business Cards', printingNeeded: 'No' },
    { JIRA_REQUEST_TYPE_PRINT: undefined, JIRA_REQUEST_TYPE_DIGITAL: undefined }
  );
  assert.equal(created.requestTypeId, '123', 'must fall back, not fail');
});

test('an invalid routing value sends the default request type', async () => {
  const { created } = await capturedCreateBody(
    { requestType: 'Digital Asset Creation' },
    { JIRA_REQUEST_TYPE_DIGITAL: 'not-an-id' }
  );
  assert.equal(created.requestTypeId, '123');
});

test('a browser-supplied requestTypeId is ignored end to end', async () => {
  // The payload carries a hostile requestTypeId; routing must ignore it and use
  // the environment value for the submitted category.
  const { created } = await capturedCreateBody({
    requestType: 'Digital Asset Creation',
    requestTypeId: '999',
    jiraRequestTypeId: '999',
  });
  assert.equal(created.requestTypeId, '116', 'the injected id must not be honoured');
  assert.notEqual(created.requestTypeId, '999');
});

test('the requested date is sent as a bare ISO string in customfield_10301', async () => {
  const { created } = await capturedCreateBody({ requestType: 'Custom / Other' });
  assert.equal(created.requestFieldValues.customfield_10301, FUTURE);
  assert.equal(typeof created.requestFieldValues.customfield_10301, 'string');
  assert.match(created.requestFieldValues.customfield_10301, /^\d{4}-\d{2}-\d{2}$/);
});

test('a malformed date stays in the description and is never sent structurally', async () => {
  // zod rejects a non-ISO dateNeeded at init, so drive fieldMap directly with
  // the same env the route uses.
  const { buildRequestFieldValues } = await import('../src/lib/jira/fieldMap.js');
  const { requestFieldValues, unmapped } = buildRequestFieldValues(
    { ...BASE_FORM, dateNeeded: '12/01/2026' },
    { env: { JIRA_FIELD_DATE_NEEDED: 'customfield_10301' } }
  );
  assert.equal(requestFieldValues.customfield_10301, undefined, 'no invalid date may reach Jira');
  assert.ok(unmapped.includes('dateNeeded'));
  assert.match(requestFieldValues.description, /12\/01\/2026/);
});

test('routing does not disturb attachment handling or R2 cleanup', async () => {
  const log = {};
  const { response, json, r2Log } = await initThenFinalize({
    jira: jiraHappyPath(log),
    submissionId: 'sub-routing-attach',
  });
  assert.equal(response.status, 201);
  assert.deepEqual(json.attachments, { total: 1, attached: 1, failed: 0, warning: null });
  assert.equal(r2Log.deletes.length, 1, 'the staged object must still be deleted');
  assert.equal(r2Log.deletes[0], r2Log.heads[0]);
});
