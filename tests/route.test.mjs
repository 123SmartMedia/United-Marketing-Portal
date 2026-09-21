import test from 'node:test';
import assert from 'node:assert/strict';

import { POST } from '../src/app/api/jira/requests/route.js';
import { __resetRateLimitState } from '../src/lib/rateLimit.js';
import { __resetIdempotencyStore } from '../src/lib/idempotencyStore.js';

/**
 * End-to-end tests of the submission endpoint with Jira and Cloudflare mocked at
 * the network boundary. No live Jira call and no live siteverify call is ever
 * made, and no ticket is ever created.
 *
 * The Turnstile keys below are Cloudflare's published test keys — documented
 * dummy values, not secrets.
 */

const ORIGIN = 'https://marketing.unitedmortgage.com';
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

const TURNSTILE_TEST_SECRET_PASSES = '1x0000000000000000000000000000000AA';
const VALID_TOKEN = 'turnstile-token-placeholder';

const VALID_BODY = {
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
  turnstileToken: VALID_TOKEN,
};

const ENV = {
  JIRA_AUTH_MODE: 'scoped_token',
  JIRA_SITE_URL: 'https://example.atlassian.net',
  JIRA_BASE_URL: undefined,
  JIRA_CLOUD_ID: 'cloud-id-1234',
  JIRA_API_TOKEN: 'jira-token-placeholder',
  JIRA_SERVICE_DESK_ID: '42',
  JIRA_REQUEST_TYPE_ID: '118',
  JIRA_ACK_EMAIL: 'false',
  JIRA_EMAIL_FALLBACK: 'false',
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_PASSES,
  TURNSTILE_EXPECTED_HOSTNAME: 'marketing.unitedmortgage.com',
  TURNSTILE_ACTION: undefined,
  ALLOWED_REQUEST_EMAIL_DOMAINS: 'unitedmortgage.com',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  R2_UPLOADS_BUCKET: 'umc-request-uploads',
};

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function post(body, { origin = ORIGIN, headers = {} } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`${ORIGIN}/api/jira/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { origin } : {}),
      'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
      ...headers,
    },
    body: raw,
  });
}

/**
 * Mock fetch: Cloudflare siteverify is answered by `turnstile`, everything else
 * by `jira`. Any unexpected call throws, so a test that should short-circuit
 * really does.
 */
function mockNetwork({ turnstile, jira }) {
  return async (url, init) => {
    const href = String(url);
    if (href === SITEVERIFY) {
      if (!turnstile) throw new Error('siteverify must not be called');
      return turnstile(new URLSearchParams(init.body));
    }
    if (!jira) throw new Error(`Jira must not be called (${href})`);
    return jira(href, init);
  };
}

const turnstilePasses = () =>
  new Response(JSON.stringify({ success: true, hostname: 'marketing.unitedmortgage.com' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const createdResponse = (key = 'MKT-123') =>
  new Response(
    JSON.stringify({
      issueKey: key,
      _links: { web: `https://example.atlassian.net/servicedesk/customer/portal/68/${key}` },
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );

/** Run `fn` with the env applied and global fetch mocked. */
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

test.beforeEach(() => {
  __resetRateLimitState();
  __resetIdempotencyStore();
});

// --- happy path ------------------------------------------------------------

test('a valid submission creates one Jira request and returns the ticket number', async () => {
  let jiraCalls = 0;
  await withEnv(
    mockNetwork({
      turnstile: turnstilePasses,
      jira: () => {
        jiraCalls += 1;
        return createdResponse('MKT-123');
      },
    }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, submissionId: 'sub-success' }));
      const json = await response.json();

      assert.equal(response.status, 201);
      assert.equal(json.ok, true);
      assert.equal(json.requestKey, 'MKT-123');
      assert.match(json.requestUrl, /portal\/68\/MKT-123$/);
      assert.ok(json.correlationId);
      assert.equal(jiraCalls, 1);
    }
  );
});

test('no secret, credential, Jira field id or R2 key reaches the browser', async () => {
  await withEnv(
    mockNetwork({ turnstile: turnstilePasses, jira: () => createdResponse() }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, submissionId: 'sub-secret' }));
      const text = await response.text();
      for (const secret of [
        'jira-token-placeholder',
        TURNSTILE_TEST_SECRET_PASSES,
        VALID_TOKEN,
        'cloud-id-1234',
        'customfield_',
        'Bearer ',
        'requests/',
        'r2.cloudflarestorage.com',
      ]) {
        assert.ok(!text.includes(secret), `response leaked: ${secret}`);
      }
    },
    { JIRA_FIELD_NMLS: 'customfield_10099' }
  );
});

// --- Turnstile -------------------------------------------------------------

test('a missing Turnstile token is rejected before Jira is contacted', async () => {
  await withEnv(
    mockNetwork({ turnstile: null, jira: null }),
    async () => {
      const { turnstileToken, ...noToken } = VALID_BODY;
      const response = await POST(post({ ...noToken, submissionId: 'sub-no-token' }));
      const json = await response.json();
      assert.equal(response.status, 400);
      assert.equal(json.error, 'turnstile_missing');
      assert.equal(json.resetChallenge, true);
      assert.match(json.message, /verify/i);
    }
  );
});

test('a failed challenge is rejected and Jira is never called', async () => {
  await withEnv(
    mockNetwork({
      turnstile: () =>
        new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), {
          status: 200,
        }),
      jira: null,
    }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, submissionId: 'sub-bad-token' }));
      const json = await response.json();
      assert.equal(response.status, 400);
      assert.equal(json.error, 'turnstile_malformed');
      assert.equal(json.ok, false);
    }
  );
});

test('a token solved on another hostname is rejected', async () => {
  await withEnv(
    mockNetwork({
      turnstile: () =>
        new Response(JSON.stringify({ success: true, hostname: 'phishing.example.com' }), { status: 200 }),
      jira: null,
    }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, submissionId: 'sub-host' }));
      const json = await response.json();
      assert.equal(json.error, 'turnstile_hostname_mismatch');
    }
  );
});

test('a replayed token is rejected', async () => {
  const spent = new Set();
  await withEnv(
    mockNetwork({
      turnstile: (body) => {
        const token = body.get('response');
        if (spent.has(token)) {
          return new Response(JSON.stringify({ success: false, 'error-codes': ['timeout-or-duplicate'] }), {
            status: 200,
          });
        }
        spent.add(token);
        return turnstilePasses();
      },
      jira: () => createdResponse('MKT-500'),
    }),
    async () => {
      const first = await POST(post({ ...VALID_BODY, submissionId: 'sub-replay-1' }));
      assert.equal(first.status, 201);

      // Same token, different submission id — must not create a second ticket.
      const second = await POST(post({ ...VALID_BODY, submissionId: 'sub-replay-2' }));
      const json = await second.json();
      assert.equal(second.status, 400);
      assert.equal(json.error, 'turnstile_duplicate');
    }
  );
});

test('a siteverify timeout fails closed with a 503 and no ticket', async () => {
  await withEnv(
    mockNetwork({
      turnstile: () => {
        const err = new Error('aborted');
        err.name = 'TimeoutError';
        throw err;
      },
      jira: null,
    }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, submissionId: 'sub-ts-timeout' }));
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error, 'turnstile_timeout');
      // A siteverify timeout is a dependency failure, not bad client input.
      assert.equal(response.status, 503);
    }
  );
});

test('an unreachable siteverify never lets a submission through', async () => {
  await withEnv(
    mockNetwork({
      turnstile: () => new Response('{}', { status: 502 }),
      jira: null,
    }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, submissionId: 'sub-ts-down' }));
      const json = await response.json();
      assert.equal(response.status, 503);
      assert.equal(json.error, 'turnstile_unavailable');
    }
  );
});

test('the honeypot still short-circuits before any siteverify call', async () => {
  await withEnv(
    mockNetwork({ turnstile: null, jira: null }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, company: 'Acme Bots' }));
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.requestKey, null);
    }
  );
});

// --- submitter allow-list --------------------------------------------------

test('a non-company email is refused before Turnstile and Jira', async () => {
  await withEnv(
    mockNetwork({ turnstile: null, jira: null }),
    async () => {
      const response = await POST(
        post({ ...VALID_BODY, email: 'someone@gmail.com', submissionId: 'sub-domain' })
      );
      const json = await response.json();
      assert.equal(response.status, 403);
      assert.equal(json.error, 'email_domain_not_allowed');
      assert.deepEqual(json.fields, ['email']);
      assert.match(json.message, /United Mortgage work email/);
    }
  );
});

test('with no allow-list configured any domain is accepted (local dev)', async () => {
  await withEnv(
    mockNetwork({ turnstile: turnstilePasses, jira: () => createdResponse() }),
    async () => {
      const response = await POST(
        post({ ...VALID_BODY, email: 'someone@gmail.com', submissionId: 'sub-anydomain' })
      );
      assert.equal(response.status, 201);
    },
    { ALLOWED_REQUEST_EMAIL_DOMAINS: undefined }
  );
});

// --- transport-level guards ------------------------------------------------

test('a cross-origin post is refused', async () => {
  await withEnv(
    mockNetwork({ turnstile: null, jira: null }),
    async () => {
      const response = await POST(post(VALID_BODY, { origin: 'https://evil.example.com' }));
      assert.equal(response.status, 403);
      assert.equal((await response.json()).ok, false);
    }
  );
});

test('an invalid submission is rejected with field paths but never the submitted values', async () => {
  await withEnv(
    mockNetwork({ turnstile: null, jira: null }),
    async () => {
      const response = await POST(post({ source: 'wizard', name: '', email: 'nope' }));
      assert.equal(response.status, 400);
      const json = await response.json();
      assert.ok(json.fields.includes('email'));
      assert.ok(json.fields.includes('name'));
      assert.ok(!JSON.stringify(json).includes('nope'));
    }
  );
});

test('malformed JSON and oversized payloads are refused early', async () => {
  await withEnv(
    mockNetwork({ turnstile: null, jira: null }),
    async () => {
      assert.equal((await POST(post('{not json'))).status, 400);
      assert.equal(
        (await POST(post({ ...VALID_BODY, additionalDetails: 'x'.repeat(200 * 1024) }))).status,
        413
      );
    }
  );
});

// --- duplicate protection --------------------------------------------------

test('repeating a submission id returns the original ticket instead of a second one', async () => {
  let jiraCalls = 0;
  await withEnv(
    mockNetwork({
      turnstile: turnstilePasses,
      jira: () => {
        jiraCalls += 1;
        return createdResponse('MKT-777');
      },
    }),
    async () => {
      const first = await (await POST(post({ ...VALID_BODY, submissionId: 'sub-dupe' }))).json();
      const second = await (await POST(post({ ...VALID_BODY, submissionId: 'sub-dupe' }))).json();

      assert.equal(jiraCalls, 1, 'a duplicate submission reached Jira');
      assert.equal(first.requestKey, 'MKT-777');
      assert.equal(second.requestKey, 'MKT-777');
      assert.equal(second.duplicate, true);
    }
  );
});

// --- Jira failures ---------------------------------------------------------

test('a Jira authentication failure returns a generic message, not the Jira error', async () => {
  await withEnv(
    mockNetwork({
      turnstile: turnstilePasses,
      jira: () => new Response(JSON.stringify({ errorMessages: ['Client must be authenticated'] }), { status: 401 }),
    }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, submissionId: 'sub-401' }));
      const json = await response.json();
      assert.equal(response.status, 502);
      assert.equal(json.ok, false);
      assert.ok(json.correlationId);
      assert.doesNotMatch(json.message, /authenticat/i);
      assert.ok(!JSON.stringify(json).includes('Client must be authenticated'));
    }
  );
});

test('Jira rate limiting and timeouts never claim success', async () => {
  await withEnv(
    mockNetwork({ turnstile: turnstilePasses, jira: () => new Response('{}', { status: 429 }) }),
    async () => {
      const json = await (await POST(post({ ...VALID_BODY, submissionId: 'sub-429' }))).json();
      assert.equal(json.ok, false);
      assert.equal(json.requestKey, undefined);
    }
  );

  await withEnv(
    mockNetwork({
      turnstile: turnstilePasses,
      jira: () => {
        const err = new Error('timed out');
        err.name = 'TimeoutError';
        throw err;
      },
    }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, submissionId: 'sub-timeout' }));
      const json = await response.json();
      assert.equal(response.status, 504);
      assert.equal(json.ok, false);
      assert.match(json.message, /try again/i);
    }
  );
});

test('an unconfigured integration returns 503 and never claims success', async () => {
  await withEnv(
    mockNetwork({ turnstile: turnstilePasses, jira: null }),
    async () => {
      const response = await POST(post({ ...VALID_BODY, submissionId: 'sub-unconf' }));
      const json = await response.json();
      assert.equal(response.status, 503);
      assert.equal(json.ok, false);
      assert.match(json.message, /marketing@unitedmortgage\.com/);
    },
    { JIRA_CLOUD_ID: undefined }
  );
});

// --- attachments -----------------------------------------------------------

test('a forged object key is refused and never reaches storage or Jira', async () => {
  await withEnv(
    mockNetwork({ turnstile: turnstilePasses, jira: null }),
    async () => {
      const response = await POST(
        post({
          ...VALID_BODY,
          submissionId: 'sub-forged-key',
          files: [{ name: 'a.png', size: 100, type: 'image/png', key: '../../admin/uploads/secret.pdf' }],
        })
      );
      const json = await response.json();
      assert.equal(response.status, 400);
      assert.equal(json.ok, false);
      assert.ok(!JSON.stringify(json).includes('admin/uploads'));
    }
  );
});

test('a rejected attachment blocks the submission with an actionable message', async () => {
  await withEnv(
    mockNetwork({ turnstile: turnstilePasses, jira: null }),
    async () => {
      const response = await POST(
        post({
          ...VALID_BODY,
          submissionId: 'sub-attach',
          files: [
            {
              name: 'payload.exe',
              size: 100,
              type: 'application/pdf',
              key: 'requests/2026-09-21/11112222-3333-4444-5555-666677778888.pdf',
            },
          ],
        })
      );
      const json = await response.json();
      assert.equal(response.status, 400);
      assert.match(json.message, /PDF, PNG, or JPG/);
    }
  );
});

// --- throttling ------------------------------------------------------------

test('repeated submissions from one client are throttled', async () => {
  await withEnv(
    mockNetwork({ turnstile: turnstilePasses, jira: () => createdResponse() }),
    async () => {
      const ip = '198.51.100.7';
      const send = (n) =>
        POST(post({ ...VALID_BODY, submissionId: `sub-rl-${n}` }, { headers: { 'x-forwarded-for': ip } }));

      for (let i = 0; i < 5; i += 1) {
        assert.equal((await send(i)).status, 201, `submission ${i + 1} should have been accepted`);
      }
      const blocked = await send(99);
      assert.equal(blocked.status, 429);
      assert.ok(blocked.headers.get('Retry-After'));
    }
  );
});
