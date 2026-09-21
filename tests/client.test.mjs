import test from 'node:test';
import assert from 'node:assert/strict';

import {
  jiraFetch,
  classifyStatus,
  extractFieldErrors,
  JiraError,
  JIRA_ERRORS,
} from '../src/lib/jira/client.js';

const CONFIG = {
  authMode: 'site_basic',
  apiBaseUrl: 'https://example.atlassian.net',
  siteUrl: 'https://example.atlassian.net',
  cloudId: '',
  serviceAccountEmail: 'integration@unitedmortgage.com',
  token: 'super-secret-token-value',
  serviceDeskId: '42',
  requestTypeId: '118',
  timeoutMs: 1000,
  portalUrl: 'https://example.atlassian.net/servicedesk/customer/portal/68',
};

/** Swap global fetch for the duration of one case. */
async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const jsonResponse = (status, body) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('HTTP statuses map onto normalized error codes', () => {
  assert.equal(classifyStatus(400), JIRA_ERRORS.VALIDATION);
  assert.equal(classifyStatus(422), JIRA_ERRORS.VALIDATION);
  assert.equal(classifyStatus(401), JIRA_ERRORS.AUTH);
  assert.equal(classifyStatus(403), JIRA_ERRORS.PERMISSION);
  assert.equal(classifyStatus(404), JIRA_ERRORS.NOT_FOUND);
  assert.equal(classifyStatus(413), JIRA_ERRORS.PAYLOAD_TOO_LARGE);
  assert.equal(classifyStatus(429), JIRA_ERRORS.RATE_LIMITED);
  assert.equal(classifyStatus(500), JIRA_ERRORS.UNAVAILABLE);
  assert.equal(classifyStatus(503), JIRA_ERRORS.UNAVAILABLE);
});

test('missing credentials fail before any network call is attempted', async () => {
  await withFetch(
    () => {
      throw new Error('fetch must not be called');
    },
    async () => {
      await assert.rejects(
        () => jiraFetch('/rest/servicedeskapi/request', { config: { ...CONFIG, token: '' } }),
        (err) => err instanceof JiraError && err.code === JIRA_ERRORS.NOT_CONFIGURED
      );
    }
  );
});

test('requests carry Basic auth and the token never appears in a thrown error', async () => {
  let seenAuth = null;
  await withFetch(
    async (url, init) => {
      seenAuth = init.headers.Authorization;
      return jsonResponse(401, { errorMessages: ['Client must be authenticated'] });
    },
    async () => {
      const err = await jiraFetch('/rest/servicedeskapi/request', { config: CONFIG }).catch((e) => e);
      assert.equal(err.code, JIRA_ERRORS.AUTH);
      assert.equal(err.status, 401);
      // The header was sent…
      assert.ok(seenAuth.startsWith('Basic '));
      // …but nothing derived from the token is on the error object.
      const serialized = JSON.stringify({ message: err.message, code: err.code, detail: err.detail });
      assert.ok(!serialized.includes(CONFIG.token));
      assert.ok(!serialized.includes(seenAuth));
    }
  );
});

test('a 429 from Jira is reported as rate limited', async () => {
  await withFetch(
    async () => jsonResponse(429, { errorMessages: ['Too many requests'] }),
    async () => {
      const err = await jiraFetch('/x', { config: CONFIG }).catch((e) => e);
      assert.equal(err.code, JIRA_ERRORS.RATE_LIMITED);
      assert.equal(err.status, 429);
    }
  );
});

test('a timeout is reported as a timeout, not a generic outage', async () => {
  await withFetch(
    async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    },
    async () => {
      const err = await jiraFetch('/x', { config: CONFIG }).catch((e) => e);
      assert.equal(err.code, JIRA_ERRORS.TIMEOUT);
    }
  );
});

test('a transport failure is reported as a network error', async () => {
  await withFetch(
    async () => {
      throw new TypeError('fetch failed');
    },
    async () => {
      const err = await jiraFetch('/x', { config: CONFIG }).catch((e) => e);
      assert.equal(err.code, JIRA_ERRORS.NETWORK);
    }
  );
});

test('Jira validation errors expose per-field messages for the caller', async () => {
  await withFetch(
    async () =>
      jsonResponse(400, {
        errorMessage: 'Invalid request',
        errors: { customfield_10052: 'Option id is not valid' },
        errorMessages: ['summary is required'],
      }),
    async () => {
      const err = await jiraFetch('/x', { method: 'POST', body: {}, config: CONFIG }).catch((e) => e);
      assert.equal(err.code, JIRA_ERRORS.VALIDATION);
      assert.equal(err.fieldErrors.customfield_10052, 'Option id is not valid');
      assert.match(err.fieldErrors.__general, /summary is required/);
    }
  );
});

test('a non-JSON error body does not crash the client', async () => {
  await withFetch(
    async () => new Response('<html>Gateway Timeout</html>', { status: 504 }),
    async () => {
      const err = await jiraFetch('/x', { config: CONFIG }).catch((e) => e);
      assert.equal(err.code, JIRA_ERRORS.UNAVAILABLE);
      assert.equal(err.fieldErrors, null);
    }
  );
});

test('extractFieldErrors ignores shapes it does not understand', () => {
  assert.equal(extractFieldErrors(null), null);
  assert.equal(extractFieldErrors({}), null);
  assert.equal(extractFieldErrors({ errors: { a: 1 } }), null);
});

test('a successful create returns the parsed body', async () => {
  await withFetch(
    async () => jsonResponse(201, { issueKey: 'MKT-123', _links: { web: `${CONFIG.siteUrl}/portal/68/MKT-123` } }),
    async () => {
      const result = await jiraFetch('/rest/servicedeskapi/request', {
        method: 'POST',
        body: { serviceDeskId: '42' },
        config: CONFIG,
      });
      assert.equal(result.issueKey, 'MKT-123');
    }
  );
});
