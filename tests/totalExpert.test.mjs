import test from 'node:test';
import assert from 'node:assert/strict';

import { POST } from '../src/app/api/total-expert/route.js';
import { totalExpertSchema, toJiraSubmission, TE_ROLES, TE_ACCOUNT_TYPES } from '../src/lib/totalExpertSchema.js';
import { TOTAL_EXPERT_REQUEST_TYPE } from '../src/lib/jira/requestTypeRouting.js';
import { __resetRateLimitState } from '../src/lib/rateLimit.js';
import { __resetIdempotencyStore } from '../src/lib/idempotencyStore.js';

/**
 * Total Expert sign-up: schema, mapping, and the /api/total-expert route with
 * Cloudflare siteverify and Jira mocked at the network boundary. SENDGRID_API_KEY
 * is unset, so email "delivery" is the logged dev path — nothing is sent.
 */

const ORIGIN = 'https://marketing.unitedmortgage.com';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const VALID = {
  name: 'Jane Officer',
  email: 'jofficer@unitedmortgage.com',
  phone: '631-203-7480',
  nmls: '1234567',
  branch: 'Melville, NY',
  role: 'Loan Officer',
  manager: 'Sam Manager',
  accountType: 'New account',
  startDate: '2026-10-15',
  licensedStates: 'NY, NJ',
  notes: 'Joining the Melville team.',
};

const ENV = {
  JIRA_AUTH_MODE: 'scoped_token',
  JIRA_SITE_URL: 'https://example.atlassian.net',
  JIRA_CLOUD_ID: 'cloud-id-1234',
  JIRA_API_TOKEN: 'jira-token-placeholder',
  JIRA_SERVICE_DESK_ID: '42',
  JIRA_REQUEST_TYPE_ID: '118',
  JIRA_ACK_EMAIL: 'false',
  JIRA_EMAIL_FALLBACK: 'false',
  SENDGRID_API_KEY: undefined,
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_EXPECTED_HOSTNAME: 'marketing.unitedmortgage.com',
  ALLOWED_REQUEST_EMAIL_DOMAINS: 'unitedmortgage.com',
};

// --- schema ------------------------------------------------------------------

test('schema accepts a complete sign-up', () => {
  assert.equal(totalExpertSchema.safeParse(VALID).success, true);
});

test('schema accepts the optional fields left blank', () => {
  const r = totalExpertSchema.safeParse({ ...VALID, startDate: '', licensedStates: '', notes: '' });
  assert.equal(r.success, true);
});

test('schema reports every missing required field', () => {
  const r = totalExpertSchema.safeParse({});
  assert.equal(r.success, false);
  const paths = new Set(r.error.issues.map((i) => i.path[0]));
  for (const key of ['name', 'email', 'phone', 'nmls', 'branch', 'role', 'manager', 'accountType']) {
    assert.ok(paths.has(key), `${key} should be required`);
  }
});

test('schema rejects values outside the option lists and malformed dates', () => {
  assert.equal(totalExpertSchema.safeParse({ ...VALID, role: 'CEO' }).success, false);
  assert.equal(totalExpertSchema.safeParse({ ...VALID, accountType: 'Delete my account' }).success, false);
  assert.equal(totalExpertSchema.safeParse({ ...VALID, startDate: '10/15/2026' }).success, false);
  assert.equal(totalExpertSchema.safeParse({ ...VALID, notes: 'x'.repeat(2001) }).success, false);
  assert.ok(TE_ROLES.includes('Loan Officer') && TE_ACCOUNT_TYPES.includes('New account'));
});

test('schema passes the honeypot through so the route can see it', () => {
  const r = totalExpertSchema.safeParse({ ...VALID, company: 'Bot LLC' });
  assert.equal(r.success, true);
  assert.equal(r.data.company, 'Bot LLC');
});

// --- mapping -----------------------------------------------------------------

test('toJiraSubmission produces the shape the Jira and email pipelines render', () => {
  const s = toJiraSubmission(totalExpertSchema.parse(VALID));
  assert.equal(s.requestType, TOTAL_EXPERT_REQUEST_TYPE);
  assert.equal(s.projectTitle, 'Total Expert account — New account');
  assert.match(s.keyMessage, /Jane Officer/);
  assert.match(s.keyMessage, /1234567/);
  for (const text of ['Role: Loan Officer', 'Manager: Sam Manager', 'Start date: 2026-10-15', 'Licensed states: NY, NJ', 'Notes: Joining']) {
    assert.ok(s.additionalDetails.includes(text), `missing "${text}"`);
  }
  assert.equal(s.email, VALID.email);
  assert.deepEqual(s.files, []);
});

test('toJiraSubmission omits blank optional lines', () => {
  const s = toJiraSubmission(totalExpertSchema.parse({ ...VALID, startDate: '', licensedStates: '', notes: '' }));
  assert.ok(!s.additionalDetails.includes('Start date'));
  assert.ok(!s.additionalDetails.includes('Notes'));
});

// --- route -------------------------------------------------------------------

function post(body, { origin = ORIGIN } = {}) {
  return new Request(`${ORIGIN}/api/total-expert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { origin } : {}),
      'x-forwarded-for': `10.1.0.${Math.floor(Math.random() * 250) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

const turnstilePasses = () =>
  new Response(JSON.stringify({ success: true, hostname: 'marketing.unitedmortgage.com' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const created = (key) =>
  new Response(JSON.stringify({ issueKey: key, _links: { web: `https://example.atlassian.net/portal/68/${key}` } }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

function network({ turnstile, jira }) {
  return async (url, init) => {
    if (String(url) === SITEVERIFY) {
      if (!turnstile) throw new Error('siteverify must not be called');
      return turnstile();
    }
    if (!jira) throw new Error(`unexpected call: ${url}`);
    return jira(String(url), init);
  };
}

async function withEnv(fetchImpl, fn, overrides = {}) {
  const saved = {};
  for (const [key, value] of Object.entries({ ...ENV, ...overrides })) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  globalThis.fetch = fetchImpl;
  console.log = () => {}; // silence the "SENDGRID_API_KEY not set" dev logging
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const body = (id, extra = {}) => ({ ...VALID, submissionId: id, turnstileToken: 'token-placeholder', ...extra });

test.beforeEach(() => {
  __resetRateLimitState();
  __resetIdempotencyStore();
});

test('a valid sign-up opens one Jira ticket routed to the Total Expert request type', async () => {
  const sent = [];
  await withEnv(
    network({
      turnstile: turnstilePasses,
      jira: (url, init) => {
        sent.push(JSON.parse(init.body));
        return created('MKT-900');
      },
    }),
    async () => {
      const res = await POST(post(body('te-happy-path')));
      const json = await res.json();
      assert.equal(res.status, 201);
      assert.equal(json.ok, true);
      assert.equal(json.requestKey, 'MKT-900');
      assert.equal(json.fallback, undefined);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].requestTypeId, '131');
      assert.match(sent[0].requestFieldValues.summary, /Total Expert account/);
      assert.ok(!JSON.stringify(json).includes('jira-token-placeholder'));
    },
    { JIRA_REQUEST_TYPE_TOTAL_EXPERT: '131' }
  );
});

test('with Jira unconfigured the sign-up is emailed to the desk instead', async () => {
  await withEnv(
    network({ turnstile: turnstilePasses, jira: null }),
    async () => {
      const res = await POST(post(body('te-no-jira')));
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.fallback, 'email');
      assert.equal(json.requestKey, null);
    },
    { JIRA_SERVICE_DESK_ID: undefined, JIRA_API_TOKEN: undefined }
  );
});

test('a Jira failure also falls back to email, regardless of JIRA_EMAIL_FALLBACK', async () => {
  await withEnv(
    network({ turnstile: turnstilePasses, jira: () => new Response('{}', { status: 500 }) }),
    async () => {
      const res = await POST(post(body('te-jira-down')));
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.fallback, 'email');
    }
  );
});

test('a cross-origin post is refused before anything else runs', async () => {
  await withEnv(network({ turnstile: null, jira: null }), async () => {
    const res = await POST(post(body('te-cross-origin'), { origin: 'https://evil.example' }));
    assert.equal(res.status, 403);
  });
});

test('a non-United email is refused before Turnstile or Jira', async () => {
  await withEnv(network({ turnstile: null, jira: null }), async () => {
    const res = await POST(post(body('te-gmail', { email: 'someone@gmail.com' })));
    const json = await res.json();
    assert.equal(res.status, 403);
    assert.equal(json.error, 'email_domain_not_allowed');
    assert.deepEqual(json.fields, ['email']);
  });
});

test('a missing Turnstile token is rejected and asks for a fresh challenge', async () => {
  await withEnv(network({ turnstile: null, jira: null }), async () => {
    const res = await POST(post(body('te-no-token', { turnstileToken: undefined })));
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error, 'turnstile_missing');
    assert.equal(json.resetChallenge, true);
  });
});

test('invalid fields come back as field paths only', async () => {
  await withEnv(network({ turnstile: null, jira: null }), async () => {
    const res = await POST(post(body('te-invalid', { role: 'CEO', manager: '' })));
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.ok(json.fields.includes('role'));
    assert.ok(json.fields.includes('manager'));
  });
});

test('the honeypot is accepted silently and creates nothing', async () => {
  await withEnv(network({ turnstile: null, jira: null }), async () => {
    const res = await POST(post(body('te-honeypot', { company: 'Bot LLC' })));
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.requestKey, null);
  });
});

test('a repeated submission id returns the original ticket instead of a second one', async () => {
  let calls = 0;
  await withEnv(
    network({
      turnstile: turnstilePasses,
      jira: () => {
        calls += 1;
        return created('MKT-901');
      },
    }),
    async () => {
      await POST(post(body('te-duplicate')));
      const res = await POST(post(body('te-duplicate')));
      const json = await res.json();
      assert.equal(json.requestKey, 'MKT-901');
      assert.equal(json.duplicate, true);
      assert.equal(calls, 1);
    }
  );
});
