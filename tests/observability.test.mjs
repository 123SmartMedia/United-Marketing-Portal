import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  logFailure,
  logRejection,
  logSuccess,
  deploymentInfo,
  sanitizeReason,
  ROUTES,
  STAGES,
  __SAFE_FIELDS,
} from '../src/lib/observability.js';

/**
 * Structured logging.
 *
 * The motivating incident: a production submission failed with a safe Reference
 * ID, and the log line for it carried no route, no stage, no status and no
 * deployment — so the ID alone could not be turned into a diagnosis. Two call
 * sites also logged an attachment filename, which is submitted content.
 *
 * These tests pin both halves: every failure is findable by Reference ID, and
 * the logger cannot be made to emit anything sensitive.
 */

/** Capture one console method and return the parsed JSON lines it received. */
function capture(method, fn) {
  const original = console[method];
  const lines = [];
  console[method] = (...args) => lines.push(...args);
  try {
    fn();
  } finally {
    console[method] = original;
  }
  return lines.map((line) => JSON.parse(line));
}

const REFERENCE_ID = '855e0232-8603-46b2-acf9-1d447abbe425';

// --- the Reference ID must be matchable ------------------------------------

test('a failure log carries route, stage, category, status and the Reference ID', () => {
  const [entry] = capture('error', () =>
    logFailure({
      route: ROUTES.FINALIZE,
      stage: STAGES.JIRA_CONFIGURATION,
      category: 'jira_not_configured',
      status: 503,
      correlationId: REFERENCE_ID,
      missingEnv: ['JIRA_API_TOKEN', 'JIRA_REQUEST_TYPE_ID'],
    })
  );

  assert.equal(entry.correlationId, REFERENCE_ID);
  assert.equal(entry.route, '/api/jira/requests/finalize');
  assert.equal(entry.stage, 'jira_configuration');
  assert.equal(entry.category, 'jira_not_configured');
  assert.equal(entry.status, 503);
  assert.deepEqual(entry.missingEnv, ['JIRA_API_TOKEN', 'JIRA_REQUEST_TYPE_ID']);
  assert.equal(entry.event, 'request_failure');
  assert.ok(entry.ts, 'a timestamp is needed to order entries');
});

test('an upstream status is recorded when supplied', () => {
  const [entry] = capture('error', () =>
    logFailure({
      route: ROUTES.FINALIZE,
      stage: STAGES.JIRA_REQUEST_CREATION,
      category: 'jira_auth_failed',
      status: 502,
      upstreamStatus: 401,
      correlationId: REFERENCE_ID,
    })
  );
  assert.equal(entry.upstreamStatus, 401);
});

test('the deployment identifier is included when the platform provides it', () => {
  const saved = { ...process.env };
  process.env.VERCEL_DEPLOYMENT_ID = 'dpl_test123';
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890';
  process.env.VERCEL_REGION = 'iad1';
  try {
    const [entry] = capture('error', () => logFailure({ correlationId: REFERENCE_ID }));
    assert.deepEqual(entry.deployment, {
      id: 'dpl_test123',
      env: 'production',
      commit: 'abcdef1', // shortened
      region: 'iad1',
    });
  } finally {
    for (const key of ['VERCEL_DEPLOYMENT_ID', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA', 'VERCEL_REGION']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('absent deployment variables are omitted rather than logged as undefined', () => {
  const info = deploymentInfo({});
  assert.deepEqual(info, {});
});

test('every log line is a single parseable JSON object', () => {
  for (const [method, log] of [['error', logFailure], ['warn', logRejection], ['info', logSuccess]]) {
    const lines = capture(method, () => log({ correlationId: REFERENCE_ID, route: ROUTES.INIT }));
    assert.equal(lines.length, 1, `${method} must emit exactly one line`);
    assert.equal(typeof lines[0], 'object');
  }
});

test('rejections and successes are distinguishable from faults by event', () => {
  const [rejected] = capture('warn', () => logRejection({ correlationId: REFERENCE_ID }));
  const [succeeded] = capture('info', () => logSuccess({ correlationId: REFERENCE_ID }));
  assert.equal(rejected.event, 'request_rejected');
  assert.equal(succeeded.event, 'request_succeeded');
});

// --- the allow-list is a security control -----------------------------------

test('fields outside the allow-list are dropped, not serialized', () => {
  const [entry] = capture('error', () =>
    logFailure({
      correlationId: REFERENCE_ID,
      // Every one of these is forbidden. Passing them must be inert.
      fileName: 'borrower-tax-return.pdf',
      email: 'jofficer@unitedmortgage.com',
      name: 'Jane Officer',
      phone: '631-203-7480',
      nmls: '1234567',
      turnstileToken: 'token-value',
      finalizeToken: 'v1.aaa.bbb',
      key: 'marketing-requests/abc/def',
      bucket: 'united-marketing-request-uploads',
      uploadUrl: 'https://acct.r2.cloudflarestorage.com/x?X-Amz-Signature=deadbeef',
      authorization: 'Bearer secret-token',
      projectTitle: 'Q3 Farming Campaign',
    })
  );

  const serialized = JSON.stringify(entry);
  for (const forbidden of [
    'borrower-tax-return',
    'jofficer',
    'Jane Officer',
    '631-203-7480',
    '1234567',
    'token-value',
    'v1.aaa.bbb',
    'marketing-requests/',
    'united-marketing-request-uploads',
    'r2.cloudflarestorage.com',
    'X-Amz-Signature',
    'Bearer',
    'Q3 Farming Campaign',
  ]) {
    assert.ok(!serialized.includes(forbidden), `the logger leaked "${forbidden}"`);
  }
});

test('the allow-list contains no field that could hold submitted content', () => {
  for (const forbidden of ['fileName', 'email', 'name', 'phone', 'nmls', 'token', 'key', 'bucket', 'url', 'files']) {
    assert.ok(
      !__SAFE_FIELDS.includes(forbidden),
      `"${forbidden}" must never be loggable`
    );
  }
});

test('the free-text reason field is redacted when it looks sensitive', () => {
  assert.equal(sanitizeReason('https://acct.r2.cloudflarestorage.com/obj'), 'redacted_url');
  assert.equal(sanitizeReason('failed on marketing-requests/abc/def'), 'redacted_object_key');
  assert.equal(sanitizeReason('Authorization: Bearer abc'), 'redacted_credential');
  assert.equal(sanitizeReason('could not reach jofficer@unitedmortgage.com'), 'redacted_email');
  // An ordinary message survives.
  assert.equal(sanitizeReason('ECONNRESET'), 'ECONNRESET');
  assert.equal(sanitizeReason(undefined), undefined);
});

test('a very long reason is truncated', () => {
  const [entry] = capture('error', () =>
    logFailure({ correlationId: REFERENCE_ID, reason: 'x'.repeat(5000) })
  );
  assert.ok(entry.reason.length <= 200);
});

test('missingEnv carries variable NAMES only — a value-shaped entry is still just text', () => {
  // The contract is that callers pass names. This pins that the field exists and
  // that nothing in the logger tries to resolve a name to its value.
  const source = readFileSync('src/lib/observability.js', 'utf8');
  assert.ok(
    !/process\.env\[[^\]]*missing/i.test(source),
    'the logger must never dereference an env var name it was handed'
  );
});

// --- the routes actually use it ---------------------------------------------

test('no request route logs an attachment filename any more', () => {
  for (const file of [
    'src/app/api/jira/requests/init/route.js',
    'src/app/api/jira/requests/finalize/route.js',
    'src/app/api/jira/requests/route.js',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/fileName:\s*file\.name/.test(source), `${file} still logs a filename`);
  }
});

test('the request routes emit structured logs, not ad-hoc console calls', () => {
  for (const file of [
    'src/app/api/jira/requests/init/route.js',
    'src/app/api/jira/requests/finalize/route.js',
    'src/app/api/jira/requests/route.js',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/console\.(log|warn|error|info)\(/.test(source),
      `${file} still uses an ad-hoc console call`
    );
    assert.match(source, /logFailure|logRejection|logSuccess/, `${file} must use the structured logger`);
  }
});

test('the Jira configuration failure logs the stage and the missing variable names', () => {
  const source = readFileSync('src/app/api/jira/requests/finalize/route.js', 'utf8');
  // This is the exact line that had to explain the reported production failure.
  assert.match(source, /stage: STAGES\.JIRA_CONFIGURATION/);
  assert.match(source, /missingEnv: missingJiraConfig\(config\)/);
});
