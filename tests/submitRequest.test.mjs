import test from 'node:test';
import assert from 'node:assert/strict';

import { submitJiraRequest, resolveReporter } from '../src/lib/jira/submitRequest.js';
import { JIRA_ERRORS } from '../src/lib/jira/client.js';
import { REPORTER_MODES } from '../src/lib/jira/config.js';

const CONFIG = {
  authMode: 'scoped_token',
  apiBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-id-1234',
  siteUrl: 'https://example.atlassian.net',
  cloudId: 'cloud-id-1234',
  serviceAccountEmail: '',
  token: 'secret-token',
  serviceDeskId: '42',
  requestTypeId: '118',
  portalUrl: 'https://example.atlassian.net/servicedesk/customer/portal/68',
  reporterMode: REPORTER_MODES.SERVICE_ACCOUNT,
  allowedReporterDomains: [],
  attachmentsEnabled: true,
  emailFallbackEnabled: false,
  ackEmailEnabled: false,
  timeoutMs: 1000,
};

const SUBMISSION = {
  name: 'Jane Officer',
  email: 'jofficer@unitedmortgage.com',
  phone: '631-203-7480',
  nmls: '1234567',
  branch: 'Melville, NY',
  requestType: 'Custom / Other',
  dateNeeded: '2026-12-01',
  rush: false,
  projectTitle: 'Fall farming postcard',
  keyMessage: 'Book a free valuation.',
  additionalDetails: '',
  files: [],
};

async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const UPLOAD_KEY = 'requests/2026-09-21/2b3a1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const UPLOADS = {
  accountId: 'acct',
  accessKeyId: 'ak',
  secretAccessKey: 'sk',
  bucket: 'umc-request-uploads',
  usingPublicAssetBucket: false,
  configured: true,
};

/** Minimal stand-in for the S3 client. */
function fakeR2({ failGet = false } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command.constructor.name);
      if (command.constructor.name === 'GetObjectCommand') {
        if (failGet) throw new Error('NoSuchKey');
        return {
          ContentLength: PNG_MAGIC.length,
          Body: { transformToByteArray: async () => new Uint8Array(PNG_MAGIC) },
        };
      }
      return {};
    },
  };
}

const attachment = (over = {}) => ({
  name: 'a.png',
  size: PNG_MAGIC.length,
  type: 'image/png',
  key: UPLOAD_KEY,
  ...over,
});

const created = (key = 'MKT-123') =>
  new Response(
    JSON.stringify({ issueKey: key, _links: { web: `${CONFIG.siteUrl}/servicedesk/customer/portal/68/${key}` } }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );

test('an unconfigured integration refuses before touching the network', async () => {
  await withFetch(
    () => {
      throw new Error('fetch must not be called');
    },
    async () => {
      const result = await submitJiraRequest(SUBMISSION, {
        config: { ...CONFIG, requestTypeId: '' },
        env: {},
      });
      assert.deepEqual(result, { ok: false, error: JIRA_ERRORS.NOT_CONFIGURED });
    }
  );
});

test('a successful submission returns the ticket key and a customer-safe URL', async () => {
  await withFetch(
    async () => created('MKT-123'),
    async () => {
      const result = await submitJiraRequest(SUBMISSION, {
        config: CONFIG,
        env: {},
        correlationId: 'corr-1',
      });
      assert.equal(result.ok, true);
      assert.equal(result.issueKey, 'MKT-123');
      assert.equal(result.webUrl, `${CONFIG.siteUrl}/servicedesk/customer/portal/68/MKT-123`);
      assert.equal(result.portalUrl, CONFIG.portalUrl);
    }
  );
});

test('nothing secret is present on the returned object', async () => {
  await withFetch(
    async () => created(),
    async () => {
      const result = await submitJiraRequest(SUBMISSION, { config: CONFIG, env: { JIRA_FIELD_NMLS: 'customfield_1' } });
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes(CONFIG.token));
      assert.ok(!serialized.includes(CONFIG.cloudId));
      assert.ok(!serialized.includes('customfield_'));
      assert.ok(!serialized.includes('requestFieldValues'));
    }
  );
});

test('the created payload targets the configured desk and request type', async () => {
  let sent = null;
  await withFetch(
    async (url, init) => {
      sent = { url: String(url), body: JSON.parse(init.body) };
      return created();
    },
    async () => {
      await submitJiraRequest(SUBMISSION, { config: CONFIG, env: {} });
      assert.ok(sent.url.endsWith('/rest/servicedeskapi/request'));
      assert.equal(sent.body.serviceDeskId, '42');
      assert.equal(sent.body.requestTypeId, '118');
      assert.ok(sent.body.requestFieldValues.summary);
      assert.ok(sent.body.requestFieldValues.description);
      assert.equal(sent.body.raiseOnBehalfOf, undefined);
    }
  );
});

test('a Jira authentication failure is surfaced as a normalized code', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ errorMessages: ['unauthenticated'] }), { status: 401 }),
    async () => {
      const result = await submitJiraRequest(SUBMISSION, { config: CONFIG, env: {} });
      assert.equal(result.ok, false);
      assert.equal(result.error, JIRA_ERRORS.AUTH);
    }
  );
});

test('a Jira validation failure returns the field errors for translation', async () => {
  await withFetch(
    async () =>
      new Response(JSON.stringify({ errors: { summary: 'is required' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      const result = await submitJiraRequest(SUBMISSION, { config: CONFIG, env: {} });
      assert.equal(result.error, JIRA_ERRORS.VALIDATION);
      assert.equal(result.fieldErrors.summary, 'is required');
    }
  );
});

test('Jira rate limiting and outages are reported, never reported as success', async () => {
  for (const [status, code] of [
    [429, JIRA_ERRORS.RATE_LIMITED],
    [503, JIRA_ERRORS.UNAVAILABLE],
  ]) {
    await withFetch(
      async () => new Response('{}', { status }),
      async () => {
        const result = await submitJiraRequest(SUBMISSION, { config: CONFIG, env: {} });
        assert.equal(result.ok, false);
        assert.equal(result.error, code);
      }
    );
  }
});

test('a Jira timeout is reported as a timeout', async () => {
  await withFetch(
    async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    },
    async () => {
      const result = await submitJiraRequest(SUBMISSION, { config: CONFIG, env: {} });
      assert.equal(result.error, JIRA_ERRORS.TIMEOUT);
    }
  );
});

test('a response without an issueKey is not treated as success', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ something: 'else' }), { status: 201 }),
    async () => {
      const result = await submitJiraRequest(SUBMISSION, { config: CONFIG, env: {} });
      assert.equal(result.ok, false);
      assert.equal(result.error, JIRA_ERRORS.UNAVAILABLE);
    }
  );
});

test('an invalid attachment is rejected before any ticket is created', async () => {
  await withFetch(
    () => {
      throw new Error('fetch must not be called');
    },
    async () => {
      const result = await submitJiraRequest(
        {
          ...SUBMISSION,
          files: [attachment({ name: 'x.exe', type: 'application/pdf', key: UPLOAD_KEY })],
        },
        { config: CONFIG, env: {}, uploadsConfig: UPLOADS }
      );
      assert.equal(result.ok, false);
      assert.equal(result.error, 'attachment_rejected');
    }
  );
});

test('an attachment upload failure does not invalidate the created ticket', async () => {
  await withFetch(
    async (url) => {
      const href = String(url);
      if (href.endsWith('/rest/servicedeskapi/request')) return created('MKT-900');
      return new Response('nope', { status: 500 }); // the Jira upload fails
    },
    async () => {
      const result = await submitJiraRequest(
        { ...SUBMISSION, files: [attachment()] },
        { config: CONFIG, env: {}, uploadsConfig: UPLOADS, r2Client: fakeR2() }
      );
      assert.equal(result.ok, true);
      assert.equal(result.issueKey, 'MKT-900');
      // Honest counts: one file was meant to land, none did.
      assert.equal(result.attachments.total, 1);
      assert.equal(result.attachments.attached, 0);
      assert.equal(result.attachments.failed, 1);
      assert.equal(result.attachments.warning, 'attachment_upload_failed');
    }
  );
});

test('a partial attachment failure is reported as partial, never as all-attached', async () => {
  const KEY_2 = 'requests/2026-09-21/9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f.png';
  await withFetch(
    async (url) => {
      const href = String(url);
      if (href.endsWith('/rest/servicedeskapi/request')) return created('MKT-901');
      if (href.includes('attachTemporaryFile')) {
        return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 'tmp-1' }] }), {
          status: 201,
        });
      }
      return new Response('{}', { status: 201 });
    },
    async () => {
      const result = await submitJiraRequest(
        {
          ...SUBMISSION,
          // The second file's declared size disagrees with the stored bytes.
          files: [attachment(), attachment({ name: 'b.png', key: KEY_2, size: 999 })],
        },
        { config: CONFIG, env: {}, uploadsConfig: UPLOADS, r2Client: fakeR2() }
      );
      assert.equal(result.ok, true);
      assert.equal(result.attachments.total, 2);
      assert.equal(result.attachments.attached, 1);
      assert.equal(result.attachments.failed, 1);
      assert.equal(result.attachments.warning, 'attachment_partial_failure');
    }
  );
});

test('the filename reaches the description but the object key never does', async () => {
  let sentDescription = null;
  await withFetch(
    async (url, init) => {
      const href = String(url);
      if (href.endsWith('/rest/servicedeskapi/request')) {
        sentDescription = JSON.parse(init.body).requestFieldValues.description;
        return created();
      }
      return new Response('nope', { status: 500 });
    },
    async () => {
      await submitJiraRequest(
        { ...SUBMISSION, files: [attachment()] },
        { config: CONFIG, env: {}, uploadsConfig: UPLOADS, r2Client: fakeR2() }
      );
      assert.match(sentDescription, /a\.png/);
      assert.ok(!sentDescription.includes(UPLOAD_KEY));
      assert.ok(!sentDescription.includes('requests/'));
      assert.ok(!sentDescription.includes('http'));
    }
  );
});

test('a successful attachment run deletes the staged object', async () => {
  const r2 = fakeR2();
  await withFetch(
    async (url) => {
      const href = String(url);
      if (href.endsWith('/rest/servicedeskapi/request')) return created('MKT-902');
      if (href.includes('attachTemporaryFile')) {
        return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 'tmp-1' }] }), {
          status: 201,
        });
      }
      return new Response('{}', { status: 201 });
    },
    async () => {
      const result = await submitJiraRequest(
        { ...SUBMISSION, files: [attachment()] },
        { config: CONFIG, env: {}, uploadsConfig: UPLOADS, r2Client: r2 }
      );
      assert.equal(result.attachments.attached, 1);
      assert.equal(result.attachments.warning, null);
      assert.ok(r2.calls.includes('DeleteObjectCommand'));
    }
  );
});

// --- reporter identity -----------------------------------------------------

test('service-account mode never raises on behalf of anyone', async () => {
  const reporter = await resolveReporter(SUBMISSION, CONFIG);
  assert.equal(reporter.accountId, null);
  assert.equal(reporter.mode, REPORTER_MODES.SERVICE_ACCOUNT);
});

test('on-behalf-of is refused for an email outside the allow-list', async () => {
  await withFetch(
    () => {
      throw new Error('no customer lookup should happen');
    },
    async () => {
      const config = {
        ...CONFIG,
        reporterMode: REPORTER_MODES.ON_BEHALF_OF,
        allowedReporterDomains: ['unitedmortgage.com'],
      };
      const reporter = await resolveReporter({ ...SUBMISSION, email: 'attacker@evil.com' }, config);
      assert.equal(reporter.accountId, null);
      assert.equal(reporter.reason, 'domain_not_allowed');
    }
  );
});

test('on-behalf-of falls back to the service account when no customer matches', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ values: [] }), { status: 200 }),
    async () => {
      const config = {
        ...CONFIG,
        reporterMode: REPORTER_MODES.ON_BEHALF_OF,
        allowedReporterDomains: ['unitedmortgage.com'],
      };
      const reporter = await resolveReporter(SUBMISSION, config);
      assert.equal(reporter.accountId, null);
      assert.equal(reporter.reason, 'customer_not_found');
    }
  );
});

test('on-behalf-of uses the matched customer accountId', async () => {
  await withFetch(
    async (url) => {
      if (String(url).includes('/customer?')) {
        return new Response(
          JSON.stringify({ values: [{ accountId: 'acct-1', emailAddress: 'jofficer@unitedmortgage.com' }] }),
          { status: 200 }
        );
      }
      return created();
    },
    async () => {
      const config = {
        ...CONFIG,
        reporterMode: REPORTER_MODES.ON_BEHALF_OF,
        allowedReporterDomains: ['unitedmortgage.com'],
      };
      const reporter = await resolveReporter(SUBMISSION, config);
      assert.equal(reporter.accountId, 'acct-1');
      assert.equal(reporter.mode, REPORTER_MODES.ON_BEHALF_OF);
    }
  );
});
