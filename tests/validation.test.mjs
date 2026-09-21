import test from 'node:test';
import assert from 'node:assert/strict';

import { requestSchema, simpleSchema, REQUEST_TYPES, hasStep2 } from '../src/lib/requestSchema.js';
import { messageForError, statusForError, GENERIC_ERROR_MESSAGE } from '../src/lib/jira/responseMessages.js';
import { JIRA_ERRORS } from '../src/lib/jira/client.js';
import { ATTACHMENT_ERRORS } from '../src/lib/jira/attachments.js';
import {
  getJiraConfig,
  isJiraConfigured,
  missingJiraConfig,
  isAllowedReporterEmail,
  REPORTER_MODES,
  cleanEnv,
} from '../src/lib/jira/config.js';

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

const valid = {
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
};

const issuePaths = (result) => result.error.issues.map((i) => i.path.join('.'));

// --- form validation -------------------------------------------------------

test('a complete wizard submission validates', () => {
  const result = requestSchema.safeParse(valid);
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test('every required basic field is enforced server-side', () => {
  const result = requestSchema.safeParse({ source: 'wizard' });
  const paths = issuePaths(result);
  for (const field of ['name', 'email', 'phone', 'nmls', 'branch', 'requestType', 'projectTitle', 'keyMessage']) {
    assert.ok(paths.includes(field), `${field} was not required`);
  }
});

test('an invalid email is rejected', () => {
  const result = requestSchema.safeParse({ ...valid, email: 'not-an-email' });
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes('email'));
});

test('a date in the past is rejected', () => {
  const result = requestSchema.safeParse({ ...valid, dateNeeded: '2020-01-01' });
  assert.ok(issuePaths(result).includes('dateNeeded'));
});

test('print sub-fields become required for a print request type', () => {
  const result = requestSchema.safeParse({
    ...valid,
    requestType: 'Business Cards',
    printingNeeded: 'Yes',
  });
  const paths = issuePaths(result);
  assert.ok(paths.includes('quantity'));
  assert.ok(paths.includes('size'));
  assert.ok(paths.includes('finish'));
});

test('co-branding requires a partner name and a compliance confirmation', () => {
  const result = requestSchema.safeParse({ ...valid, requestType: 'Custom / Other', cobrand: 'Yes' });
  const paths = issuePaths(result);
  assert.ok(paths.includes('partnerName'));
  assert.ok(paths.includes('complianceApproved'));
});

test('a select value outside the offered options is rejected', () => {
  const result = requestSchema.safeParse({ ...valid, requestType: 'Free Ponies' });
  assert.ok(issuePaths(result).includes('requestType'));
});

test('every offered request type is accepted', () => {
  for (const requestType of REQUEST_TYPES) {
    const payload = { ...valid, requestType };
    if (requestType !== 'Custom / Other') {
      payload.printingNeeded = 'No';
      payload.cobrand = 'No';
    }
    const result = requestSchema.safeParse(payload);
    assert.equal(result.success, true, `${requestType}: ${JSON.stringify(result.error?.issues)}`);
  }
});

test('the step-2 predicate matches the schema conditionals', () => {
  assert.equal(hasStep2('Business Cards'), true);
  assert.equal(hasStep2('Custom / Other'), true);
  assert.equal(hasStep2('Digital Asset Creation'), false);
});

test('the lightweight inline-form schema stays lenient', () => {
  const result = simpleSchema.safeParse({ name: 'Sam', email: 's@x.com', details: 'Need 500 cards.' });
  assert.equal(result.success, true);
});

// --- safe error translation ------------------------------------------------

test('auth, permission, rate-limit and outage failures share one generic message', () => {
  for (const code of [
    JIRA_ERRORS.AUTH,
    JIRA_ERRORS.PERMISSION,
    JIRA_ERRORS.NOT_FOUND,
    JIRA_ERRORS.RATE_LIMITED,
    JIRA_ERRORS.UNAVAILABLE,
    JIRA_ERRORS.NETWORK,
  ]) {
    assert.equal(messageForError(code), GENERIC_ERROR_MESSAGE);
  }
});

test('user-facing messages never leak Jira internals', () => {
  const codes = [...Object.values(JIRA_ERRORS), 'validation', 'rate_limited', 'attachment_rejected'];
  for (const code of codes) {
    const message = messageForError(code, { attachmentError: ATTACHMENT_ERRORS.TOO_MANY });
    assert.doesNotMatch(message, /customfield|serviceDesk|atlassian|Basic |token/i, `leaked in: ${message}`);
  }
});

test('attachment rejections produce specific, actionable messages', () => {
  assert.match(messageForError('attachment_rejected', { attachmentError: ATTACHMENT_ERRORS.TOO_MANY }), /up to 5 files/);
  assert.match(
    messageForError('attachment_rejected', { attachmentError: ATTACHMENT_ERRORS.UNSUPPORTED_TYPE, fileName: 'x.exe' }),
    /PDF, PNG, or JPG.*x\.exe/
  );
});

test('error codes map onto sensible HTTP statuses', () => {
  assert.equal(statusForError(JIRA_ERRORS.NOT_CONFIGURED), 503);
  assert.equal(statusForError(JIRA_ERRORS.VALIDATION), 400);
  assert.equal(statusForError('attachment_rejected'), 400);
  assert.equal(statusForError(JIRA_ERRORS.PAYLOAD_TOO_LARGE), 413);
  assert.equal(statusForError(JIRA_ERRORS.TIMEOUT), 504);
  assert.equal(statusForError('rate_limited'), 429);
  assert.equal(statusForError(JIRA_ERRORS.AUTH), 502);
});

// --- configuration ---------------------------------------------------------

function withEnv(vars, run) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('config values survive stray whitespace and duplicated lines', () => {
  assert.equal(cleanEnv('  https://x.atlassian.net \n https://y '), 'https://x.atlassian.net');
  assert.equal(cleanEnv(''), '');
  assert.equal(cleanEnv(undefined), '');
});

test('an incomplete configuration is detected and named for the server log', () => {
  withEnv(
    {
      JIRA_AUTH_MODE: 'scoped_token',
      JIRA_SITE_URL: 'https://x.atlassian.net',
      JIRA_BASE_URL: undefined,
      JIRA_CLOUD_ID: '',
      JIRA_API_TOKEN: '',
      JIRA_SERVICE_DESK_ID: '',
      JIRA_REQUEST_TYPE_ID: '',
    },
    () => {
      const config = getJiraConfig();
      assert.equal(isJiraConfigured(config), false);
      assert.deepEqual(missingJiraConfig(config), [
        'JIRA_API_TOKEN',
        'JIRA_SERVICE_DESK_ID',
        'JIRA_REQUEST_TYPE_ID',
        'JIRA_CLOUD_ID',
      ]);
    }
  );
});

test('a complete configuration is accepted and defaults are sane', () => {
  withEnv(
    {
      JIRA_AUTH_MODE: 'scoped_token',
      JIRA_SITE_URL: 'https://x.atlassian.net/',
      JIRA_BASE_URL: undefined,
      JIRA_CLOUD_ID: 'cloud-1',
      JIRA_API_TOKEN: 'tok',
      JIRA_SERVICE_DESK_ID: '42',
      JIRA_REQUEST_TYPE_ID: '118',
      JIRA_REPORTER_MODE: undefined,
      JIRA_EMAIL_FALLBACK: undefined,
    },
    () => {
      const config = getJiraConfig();
      assert.equal(isJiraConfigured(config), true);
      assert.equal(config.siteUrl, 'https://x.atlassian.net'); // trailing slash stripped
      assert.equal(config.reporterMode, REPORTER_MODES.SERVICE_ACCOUNT); // safe default
      assert.equal(config.emailFallbackEnabled, false); // opt-in only
      assert.equal(config.attachmentsEnabled, true);
      assert.ok(config.portalUrl.includes('/servicedesk/customer/portal/68'));
    }
  );
});

test('a browser-supplied email can never select an arbitrary Jira customer', () => {
  const base = { reporterMode: REPORTER_MODES.ON_BEHALF_OF, allowedReporterDomains: ['unitedmortgage.com'] };
  assert.equal(isAllowedReporterEmail('jofficer@unitedmortgage.com', base), true);
  assert.equal(isAllowedReporterEmail('attacker@evil.com', base), false);
  assert.equal(isAllowedReporterEmail('no-at-sign', base), false);
  assert.equal(isAllowedReporterEmail(undefined, base), false);
  // An empty allow-list disables on-behalf-of entirely.
  assert.equal(
    isAllowedReporterEmail('jofficer@unitedmortgage.com', { ...base, allowedReporterDomains: [] }),
    false
  );
  // And the mode itself must be enabled.
  assert.equal(
    isAllowedReporterEmail('jofficer@unitedmortgage.com', {
      ...base,
      reporterMode: REPORTER_MODES.SERVICE_ACCOUNT,
    }),
    false
  );
});
