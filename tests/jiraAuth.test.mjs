import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getJiraConfig,
  isJiraConfigured,
  missingJiraConfig,
  buildApiBaseUrl,
  buildAuthHeader,
  isAllowedSubmitterEmail,
  parseDomainList,
  AUTH_MODES,
  ATLASSIAN_GATEWAY,
} from '../src/lib/jira/config.js';
import { jiraFetch, requestWebUrl } from '../src/lib/jira/client.js';

/**
 * Authentication mode selection.
 *
 * The credential values below are obvious fakes. The point of these tests is
 * that the right BASE URL and the right AUTHORIZATION SCHEME are chosen for each
 * mode, and that the credential itself never escapes into a return value or an
 * error.
 */

const SCOPED_ENV = {
  JIRA_AUTH_MODE: 'scoped_token',
  JIRA_SITE_URL: 'https://unitedmortgage.atlassian.net',
  JIRA_CLOUD_ID: '11111111-2222-3333-4444-555555555555',
  JIRA_API_TOKEN: 'scoped-token-placeholder',
  JIRA_SERVICE_DESK_ID: '42',
  JIRA_REQUEST_TYPE_ID: '118',
};

const BASIC_ENV = {
  JIRA_AUTH_MODE: 'site_basic',
  JIRA_SITE_URL: 'https://unitedmortgage.atlassian.net',
  JIRA_SERVICE_ACCOUNT_EMAIL: 'marketing-bot@unitedmortgage.com',
  JIRA_API_TOKEN: 'legacy-token-placeholder',
  JIRA_SERVICE_DESK_ID: '42',
  JIRA_REQUEST_TYPE_ID: '118',
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

// --- base URL selection ----------------------------------------------------

test('a scoped token routes through the Atlassian Platform API Gateway', () => {
  const config = getJiraConfig(SCOPED_ENV);
  assert.equal(config.authMode, AUTH_MODES.SCOPED_TOKEN);
  assert.equal(config.apiBaseUrl, `${ATLASSIAN_GATEWAY}/ex/jira/${SCOPED_ENV.JIRA_CLOUD_ID}`);
  // The site URL stays separate, for human-facing links only.
  assert.equal(config.siteUrl, 'https://unitedmortgage.atlassian.net');
  assert.notEqual(config.apiBaseUrl, config.siteUrl);
});

test('a legacy token calls the site directly', () => {
  const config = getJiraConfig(BASIC_ENV);
  assert.equal(config.authMode, AUTH_MODES.SITE_BASIC);
  assert.equal(config.apiBaseUrl, 'https://unitedmortgage.atlassian.net');
  assert.equal(config.apiBaseUrl, config.siteUrl);
});

test('the auth mode is never guessed', () => {
  const config = getJiraConfig({ ...SCOPED_ENV, JIRA_AUTH_MODE: '' });
  assert.equal(config.authMode, '');
  assert.equal(config.apiBaseUrl, '');
  assert.equal(isJiraConfigured(config), false);
  assert.deepEqual(missingJiraConfig(config), ['JIRA_AUTH_MODE']);

  // An unrecognized value is treated the same way, not coerced to a default.
  const bogus = getJiraConfig({ ...SCOPED_ENV, JIRA_AUTH_MODE: 'oauth2' });
  assert.equal(bogus.authMode, '');
  assert.equal(isJiraConfigured(bogus), false);
});

test('a scoped token with no cloud id produces no base URL at all', () => {
  const config = getJiraConfig({ ...SCOPED_ENV, JIRA_CLOUD_ID: '' });
  assert.equal(config.apiBaseUrl, '');
  assert.equal(isJiraConfigured(config), false);
  assert.ok(missingJiraConfig(config).includes('JIRA_CLOUD_ID'));
});

test('buildApiBaseUrl never falls back to a host it was not given', () => {
  assert.equal(buildApiBaseUrl({ authMode: '', siteUrl: 'https://x.atlassian.net', cloudId: 'c' }), '');
  assert.equal(buildApiBaseUrl({ authMode: AUTH_MODES.SCOPED_TOKEN, siteUrl: 'https://x.atlassian.net' }), '');
  assert.equal(buildApiBaseUrl({ authMode: AUTH_MODES.SITE_BASIC, siteUrl: '' }), '');
});

test('each mode reports exactly the variables it needs', () => {
  assert.ok(missingJiraConfig(getJiraConfig({ ...SCOPED_ENV, JIRA_CLOUD_ID: '' })).includes('JIRA_CLOUD_ID'));
  // A scoped token needs no service-account email.
  assert.ok(!missingJiraConfig(getJiraConfig(SCOPED_ENV)).includes('JIRA_SERVICE_ACCOUNT_EMAIL'));
  assert.ok(
    missingJiraConfig(getJiraConfig({ ...BASIC_ENV, JIRA_SERVICE_ACCOUNT_EMAIL: '' })).includes(
      'JIRA_SERVICE_ACCOUNT_EMAIL'
    )
  );
  assert.deepEqual(missingJiraConfig(getJiraConfig(SCOPED_ENV)), []);
  assert.deepEqual(missingJiraConfig(getJiraConfig(BASIC_ENV)), []);
});

test('JIRA_BASE_URL still works as an alias for JIRA_SITE_URL', () => {
  const { JIRA_SITE_URL, ...rest } = BASIC_ENV;
  const config = getJiraConfig({ ...rest, JIRA_BASE_URL: 'https://unitedmortgage.atlassian.net/' });
  assert.equal(config.siteUrl, 'https://unitedmortgage.atlassian.net');
  assert.equal(isJiraConfigured(config), true);
});

// --- authorization scheme --------------------------------------------------

test('a scoped token is sent as a bearer credential', () => {
  const header = buildAuthHeader(getJiraConfig(SCOPED_ENV));
  assert.ok(header.startsWith('Bearer '));
  assert.ok(!header.startsWith('Basic '));
});

test('a legacy token is sent as HTTP Basic over email:token', () => {
  const config = getJiraConfig(BASIC_ENV);
  const header = buildAuthHeader(config);
  assert.ok(header.startsWith('Basic '));
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString();
  assert.equal(decoded, `${config.serviceAccountEmail}:${config.token}`);
});

test('an incomplete credential set yields no header rather than a broken one', () => {
  assert.equal(buildAuthHeader(getJiraConfig({ ...SCOPED_ENV, JIRA_API_TOKEN: '' })), null);
  assert.equal(buildAuthHeader(getJiraConfig({ ...BASIC_ENV, JIRA_SERVICE_ACCOUNT_EMAIL: '' })), null);
  assert.equal(buildAuthHeader(getJiraConfig({ ...SCOPED_ENV, JIRA_AUTH_MODE: '' })), null);
});

test('the client actually calls the gateway with a bearer token', async () => {
  let seen = null;
  await withFetch(
    async (url, init) => {
      seen = { url: String(url), authorization: init.headers.Authorization };
      return new Response(JSON.stringify({ issueKey: 'MKT-1' }), { status: 201 });
    },
    async () => {
      await jiraFetch('/rest/servicedeskapi/request', { config: getJiraConfig(SCOPED_ENV) });
      assert.ok(seen.url.startsWith(`${ATLASSIAN_GATEWAY}/ex/jira/${SCOPED_ENV.JIRA_CLOUD_ID}/`));
      assert.ok(!seen.url.startsWith('https://unitedmortgage.atlassian.net'));
      assert.ok(seen.authorization.startsWith('Bearer '));
    }
  );
});

test('the client calls the site directly in legacy mode', async () => {
  let seen = null;
  await withFetch(
    async (url, init) => {
      seen = { url: String(url), authorization: init.headers.Authorization };
      return new Response('{}', { status: 200 });
    },
    async () => {
      await jiraFetch('/rest/servicedeskapi/servicedesk', { config: getJiraConfig(BASIC_ENV) });
      assert.ok(seen.url.startsWith('https://unitedmortgage.atlassian.net/'));
      assert.ok(!seen.url.includes('api.atlassian.com'));
      assert.ok(seen.authorization.startsWith('Basic '));
    }
  );
});

test('an unset auth mode stops the request before it is sent', async () => {
  await withFetch(
    () => {
      throw new Error('fetch must not be called');
    },
    async () => {
      await assert.rejects(() => jiraFetch('/x', { config: getJiraConfig({ ...SCOPED_ENV, JIRA_AUTH_MODE: '' }) }));
    }
  );
});

test('no credential leaks into a thrown error, on either mode', async () => {
  for (const env of [SCOPED_ENV, BASIC_ENV]) {
    await withFetch(
      async () => new Response(JSON.stringify({ errorMessages: ['denied'] }), { status: 403 }),
      async () => {
        const err = await jiraFetch('/x', { config: getJiraConfig(env) }).catch((e) => e);
        const serialized = JSON.stringify({
          message: err.message,
          code: err.code,
          detail: err.detail,
          stack: err.stack,
        });
        assert.ok(!serialized.includes(env.JIRA_API_TOKEN));
        assert.ok(!serialized.includes('Bearer '));
        assert.ok(!serialized.includes('Basic '));
      }
    );
  }
});

// --- human-facing links ----------------------------------------------------

test('a returned web link is only trusted when it is on our own site', () => {
  const config = getJiraConfig(SCOPED_ENV);
  const own = 'https://unitedmortgage.atlassian.net/servicedesk/customer/portal/68/MKT-1';
  assert.equal(requestWebUrl({ _links: { web: own } }, config), own);

  // An API-gateway link or a foreign host falls back to the configured portal.
  for (const link of [
    `${ATLASSIAN_GATEWAY}/ex/jira/abc/browse/MKT-1`,
    'https://evil.example.com/MKT-1',
    'not-a-url',
    undefined,
  ]) {
    assert.equal(requestWebUrl({ _links: { web: link } }, config), config.portalUrl);
  }
});

// --- submitter allow-list --------------------------------------------------

test('the submitter email domain allow-list is enforced server-side', () => {
  const env = { ALLOWED_REQUEST_EMAIL_DOMAINS: 'unitedmortgage.com' };
  assert.equal(isAllowedSubmitterEmail('jofficer@unitedmortgage.com', env), true);
  assert.equal(isAllowedSubmitterEmail('JOfficer@UnitedMortgage.com', env), true);
  assert.equal(isAllowedSubmitterEmail('someone@gmail.com', env), false);
  assert.equal(isAllowedSubmitterEmail('no-at-sign', env), false);
  assert.equal(isAllowedSubmitterEmail(undefined, env), false);
  // A look-alike domain does not slip through a substring check.
  assert.equal(isAllowedSubmitterEmail('x@notunitedmortgage.com', env), false);
  assert.equal(isAllowedSubmitterEmail('x@unitedmortgage.com.evil.io', env), false);
});

test('multiple domains are supported, and an empty list allows any (local dev)', () => {
  const env = { ALLOWED_REQUEST_EMAIL_DOMAINS: 'unitedmortgage.com, @umc-test.com' };
  assert.equal(isAllowedSubmitterEmail('a@umc-test.com', env), true);
  assert.equal(isAllowedSubmitterEmail('a@unitedmortgage.com', env), true);
  assert.equal(isAllowedSubmitterEmail('a@elsewhere.com', env), false);

  assert.equal(isAllowedSubmitterEmail('anyone@anywhere.com', {}), true);
});

test('parseDomainList normalizes case, whitespace and a leading @', () => {
  assert.deepEqual(parseDomainList(' UnitedMortgage.com , @Example.COM ,, '), [
    'unitedmortgage.com',
    'example.com',
  ]);
  assert.deepEqual(parseDomainList(''), []);
});
