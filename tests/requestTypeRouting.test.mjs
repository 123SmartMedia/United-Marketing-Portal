import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRequestTypeId,
  isValidRequestTypeId,
  CATEGORY_ROUTES,
  ROUTE_ENV_VARS,
  ROUTES,
  ROUTING_REASONS,
} from '../src/lib/jira/requestTypeRouting.js';
import { REQUEST_TYPES } from '../src/lib/requestSchema.js';

/**
 * Category routing.
 *
 * The IDs below were verified against live service desk 68: 116 Social Media
 * Post / Graphic, 117 Flyer / Print / Co-branded Piece, 123 General / Other.
 * All three are portal-visible on issue type 10078, field-identical, require
 * only `summary`, and accept customfield_10301.
 *
 * The security property under test is that a Jira request type ID can only ever
 * come from the environment — never from a submitted payload.
 */

const ENV = {
  JIRA_REQUEST_TYPE_ID: '123',
  JIRA_REQUEST_TYPE_PRINT: '117',
  JIRA_REQUEST_TYPE_DIGITAL: '116',
};

const resolve = (category, env = ENV) => resolveRequestTypeId(category, { env });

// --- the verified mapping ---------------------------------------------------

test('Business Cards routes to 117', () => {
  const r = resolve('Business Cards');
  assert.equal(r.requestTypeId, '117');
  assert.equal(r.route, ROUTES.PRINT);
  assert.equal(r.fallback, false);
});

test('Letterhead routes to 117', () => {
  const r = resolve('Letterhead / Stationery');
  assert.equal(r.requestTypeId, '117');
  assert.equal(r.fallback, false);
});

test('Co-branded Flyer routes to 117', () => {
  const r = resolve('Co-branded Flyer / Folder');
  assert.equal(r.requestTypeId, '117');
  assert.equal(r.fallback, false);
});

test('Print Order routes to 117', () => {
  const r = resolve('Print Order (Banner, Yard Sign, Door Hanger)');
  assert.equal(r.requestTypeId, '117');
  assert.equal(r.fallback, false);
});

test('Digital Asset routes to 116', () => {
  const r = resolve('Digital Asset Creation');
  assert.equal(r.requestTypeId, '116');
  assert.equal(r.route, ROUTES.DIGITAL);
  assert.equal(r.fallback, false);
});

test('Custom / Other routes to 123', () => {
  const r = resolve('Custom / Other');
  assert.equal(r.requestTypeId, '123');
  assert.equal(r.route, ROUTES.GENERAL);
  assert.equal(r.fallback, false);
});

test('every form category has a route — none silently falls through', () => {
  // Guards against a category being renamed in requestSchema.js without the
  // routing table following, which would quietly send everything to 123.
  for (const category of REQUEST_TYPES) {
    assert.ok(CATEGORY_ROUTES[category], `"${category}" has no route`);
  }
  assert.equal(Object.keys(CATEGORY_ROUTES).length, REQUEST_TYPES.length);
});

// --- fallback ---------------------------------------------------------------

test('missing optional routing configuration falls back to 123', () => {
  const env = { JIRA_REQUEST_TYPE_ID: '123' }; // neither PRINT nor DIGITAL set
  for (const category of ['Business Cards', 'Digital Asset Creation']) {
    const r = resolveRequestTypeId(category, { env });
    assert.equal(r.requestTypeId, '123', `${category} should fall back`);
    assert.equal(r.fallback, true);
    assert.equal(r.reason, ROUTING_REASONS.ROUTE_NOT_CONFIGURED);
  }
});

test('an invalid routing value falls back safely rather than reaching Jira', () => {
  for (const bad of ['abc', '117x', '0', '-1', '1.5', 'Flyer / Print', 'https://x/117']) {
    const r = resolveRequestTypeId('Business Cards', {
      env: { ...ENV, JIRA_REQUEST_TYPE_PRINT: bad },
    });
    assert.equal(r.requestTypeId, '123', `"${bad}" should not be sent to Jira`);
    assert.equal(r.fallback, true);
    assert.equal(r.reason, ROUTING_REASONS.ROUTE_INVALID);
  }
});

test('a blank routing value is treated as unset, not as invalid', () => {
  // Both fall back safely; they differ only in which warning the operator gets,
  // and "set this variable" is the more useful message for a blank value.
  for (const blank of ['', '   ', '\n', '\r\n  \n']) {
    const r = resolveRequestTypeId('Business Cards', {
      env: { ...ENV, JIRA_REQUEST_TYPE_PRINT: blank },
    });
    assert.equal(r.requestTypeId, '123');
    assert.equal(r.fallback, true);
    assert.equal(r.reason, ROUTING_REASONS.ROUTE_NOT_CONFIGURED);
  }
});

test('an unknown category falls back to the default', () => {
  // The lightweight inline forms default requestType to 'Custom Request'.
  for (const category of ['Custom Request', 'Something New', '', undefined, null]) {
    const r = resolveRequestTypeId(category, { env: ENV });
    assert.equal(r.requestTypeId, '123');
    assert.equal(r.fallback, true);
    assert.equal(r.reason, ROUTING_REASONS.UNKNOWN_CATEGORY);
  }
});

test('an invalid default is reported rather than sent', () => {
  const r = resolveRequestTypeId('Custom / Other', { env: { JIRA_REQUEST_TYPE_ID: 'not-an-id' } });
  assert.equal(r.requestTypeId, null);
  assert.equal(r.reason, ROUTING_REASONS.DEFAULT_INVALID);
});

test('a route value with stray whitespace or a duplicated line is cleaned', () => {
  assert.equal(resolveRequestTypeId('Business Cards', { env: { ...ENV, JIRA_REQUEST_TYPE_PRINT: '  117  ' } }).requestTypeId, '117');
  assert.equal(resolveRequestTypeId('Business Cards', { env: { ...ENV, JIRA_REQUEST_TYPE_PRINT: '117\n117' } }).requestTypeId, '117');
});

// --- the security property --------------------------------------------------

test('a browser-supplied Jira request type ID is ignored', () => {
  // resolveRequestTypeId takes a CATEGORY, never an ID. Passing an ID where the
  // category goes must not be honoured — it is an unknown category.
  for (const injected of ['999', '117', 116, { requestTypeId: '999' }]) {
    const r = resolveRequestTypeId(injected, { env: ENV });
    assert.equal(r.requestTypeId, '123', 'an injected id must not select a request type');
    assert.equal(r.reason, ROUTING_REASONS.UNKNOWN_CATEGORY);
  }
});

test('every resolved ID comes from the environment, never from the argument', () => {
  // With no routing variables at all, nothing can produce 117 or 116 regardless
  // of what is passed in.
  for (const input of ['Business Cards', 'Digital Asset Creation', '117', '116']) {
    const r = resolveRequestTypeId(input, { env: { JIRA_REQUEST_TYPE_ID: '123' } });
    assert.equal(r.requestTypeId, '123');
  }
});

test('the ID validator accepts only positive integer strings', () => {
  for (const ok of ['1', '116', '117', '123', '9999999999']) {
    assert.equal(isValidRequestTypeId(ok), true, ok);
  }
  for (const bad of ['0', '-1', '1.5', 'abc', '', '  ', '12a', null, undefined, 117, '99999999999']) {
    assert.equal(isValidRequestTypeId(bad), false, String(bad));
  }
});

test('each route names its own environment variable', () => {
  assert.equal(ROUTE_ENV_VARS[ROUTES.PRINT], 'JIRA_REQUEST_TYPE_PRINT');
  assert.equal(ROUTE_ENV_VARS[ROUTES.DIGITAL], 'JIRA_REQUEST_TYPE_DIGITAL');
  assert.equal(ROUTE_ENV_VARS[ROUTES.GENERAL], 'JIRA_REQUEST_TYPE_ID');
});

test('a fallback result names the variable to set, so the warning is actionable', () => {
  const r = resolveRequestTypeId('Business Cards', { env: { JIRA_REQUEST_TYPE_ID: '123' } });
  assert.equal(r.envVar, 'JIRA_REQUEST_TYPE_PRINT');
  // The reason is a code, not a message containing submitted data.
  assert.match(r.reason, /^[a-z_]+$/);
});
