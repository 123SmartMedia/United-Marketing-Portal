import 'server-only';

import { getJiraConfig, buildAuthHeader } from './config.js';

/**
 * Minimal Jira Service Management REST client.
 * --------------------------------------------
 * Server-only. Credentials are read from the environment per call and are never
 * returned, logged or attached to a thrown error. Errors are normalized into a
 * small set of codes the route can translate into safe, user-facing messages —
 * raw Jira response bodies never leave this module.
 *
 * The request host comes from `config.apiBaseUrl`, which the auth mode decides:
 * the Atlassian Platform API Gateway for scoped service-account tokens, or the
 * site URL for a legacy Basic-auth token. This module never falls back to a host
 * it was not given.
 */

/** Normalized failure codes. Nothing else may reach the browser. */
export const JIRA_ERRORS = Object.freeze({
  NOT_CONFIGURED: 'jira_not_configured',
  AUTH: 'jira_auth_failed',
  PERMISSION: 'jira_permission_denied',
  NOT_FOUND: 'jira_not_found',
  VALIDATION: 'jira_validation_failed',
  PAYLOAD_TOO_LARGE: 'jira_payload_too_large',
  RATE_LIMITED: 'jira_rate_limited',
  TIMEOUT: 'jira_timeout',
  UNAVAILABLE: 'jira_unavailable',
  NETWORK: 'jira_network_error',
});

export class JiraError extends Error {
  constructor(code, { status, detail, fieldErrors } = {}) {
    super(code);
    this.name = 'JiraError';
    this.code = code;
    this.status = status;
    // `detail` is for server logs only. Never serialize it to a response.
    this.detail = detail;
    // Field-level messages from Jira, keyed by Jira field ID.
    this.fieldErrors = fieldErrors || null;
  }
}

/** Map an HTTP status onto a normalized error code. */
export function classifyStatus(status) {
  if (status === 400 || status === 422) return JIRA_ERRORS.VALIDATION;
  if (status === 401) return JIRA_ERRORS.AUTH;
  if (status === 403) return JIRA_ERRORS.PERMISSION;
  if (status === 404) return JIRA_ERRORS.NOT_FOUND;
  if (status === 413) return JIRA_ERRORS.PAYLOAD_TOO_LARGE;
  if (status === 429) return JIRA_ERRORS.RATE_LIMITED;
  if (status >= 500) return JIRA_ERRORS.UNAVAILABLE;
  return JIRA_ERRORS.UNAVAILABLE;
}

/**
 * Pull field-level validation messages out of a Jira error body.
 * Jira shapes vary by endpoint; handle the documented ones and ignore the rest.
 */
export function extractFieldErrors(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  if (body.errors && typeof body.errors === 'object') {
    for (const [field, message] of Object.entries(body.errors)) {
      if (typeof message === 'string') out[field] = message;
    }
  }
  for (const entry of Array.isArray(body.errorMessages) ? body.errorMessages : []) {
    if (typeof entry === 'string') {
      out.__general = out.__general ? `${out.__general} ${entry}` : entry;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Short, log-safe excerpt of an error body — no credentials can appear here. */
async function safeErrorDetail(response) {
  try {
    const text = await response.text();
    return text.slice(0, 600);
  } catch {
    return '';
  }
}

/**
 * Perform an authenticated Jira request.
 * `body` may be a JSON-serializable object (default) or a FormData/stream when
 * `rawBody` is true (used by the temporary-file upload endpoint).
 */
export async function jiraFetch(
  path,
  { method = 'GET', body, rawBody = false, extraHeaders = {}, config = getJiraConfig(), timeoutMs } = {}
) {
  const authorization = buildAuthHeader(config);
  if (!config.apiBaseUrl || !authorization) {
    throw new JiraError(JIRA_ERRORS.NOT_CONFIGURED);
  }

  const headers = {
    Authorization: authorization,
    Accept: 'application/json',
    ...extraHeaders,
  };
  if (body !== undefined && !rawBody) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : rawBody ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs || config.timeoutMs),
      // Never let Next cache a Jira call.
      cache: 'no-store',
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new JiraError(JIRA_ERRORS.TIMEOUT, { detail: 'request timed out' });
    }
    throw new JiraError(JIRA_ERRORS.NETWORK, { detail: err?.message });
  }

  if (!response.ok) {
    const detail = await safeErrorDetail(response);
    let parsed = null;
    try {
      parsed = JSON.parse(detail);
    } catch {
      // Non-JSON error body (HTML error page, empty). Keep the excerpt only.
    }
    throw new JiraError(classifyStatus(response.status), {
      status: response.status,
      detail,
      fieldErrors: extractFieldErrors(parsed),
    });
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new JiraError(JIRA_ERRORS.UNAVAILABLE, { detail: 'non-JSON success body' });
  }
}

/** GET /rest/servicedeskapi/servicedesk */
export function listServiceDesks({ config, start = 0, limit = 50 } = {}) {
  return jiraFetch(`/rest/servicedeskapi/servicedesk?start=${start}&limit=${limit}`, { config });
}

/** GET /rest/servicedeskapi/servicedesk/{id}/requesttype */
export function listRequestTypes(serviceDeskId, { config } = {}) {
  return jiraFetch(
    `/rest/servicedeskapi/servicedesk/${encodeURIComponent(serviceDeskId)}/requesttype?limit=100`,
    { config }
  );
}

/** GET /rest/servicedeskapi/servicedesk/{id}/requesttype/{typeId}/field */
export function getRequestTypeFields(serviceDeskId, requestTypeId, { config } = {}) {
  return jiraFetch(
    `/rest/servicedeskapi/servicedesk/${encodeURIComponent(serviceDeskId)}/requesttype/${encodeURIComponent(
      requestTypeId
    )}/field`,
    { config }
  );
}

/**
 * Look up a service-desk customer by email and return their accountId.
 * Returns null when there is no match or the account lacks the permission —
 * we never create or invite a Jira customer implicitly.
 */
export async function findCustomerAccountId(serviceDeskId, email, { config } = {}) {
  try {
    const result = await jiraFetch(
      `/rest/servicedeskapi/servicedesk/${encodeURIComponent(serviceDeskId)}/customer?query=${encodeURIComponent(
        email
      )}&limit=10`,
      { config }
    );
    const match = (result?.values || []).find(
      (c) => typeof c?.emailAddress === 'string' && c.emailAddress.toLowerCase() === email.toLowerCase()
    );
    return match?.accountId || null;
  } catch {
    // Permission or lookup failure is not fatal: the caller falls back to the
    // integration account as reporter.
    return null;
  }
}

/** POST /rest/servicedeskapi/request */
export function createRequest(payload, { config } = {}) {
  return jiraFetch('/rest/servicedeskapi/request', { method: 'POST', body: payload, config });
}

/**
 * Customer-facing portal URL for a created request. Prefer the `_links.web`
 * Jira returns; fall back to the configured portal URL.
 */
export function requestWebUrl(created, config = getJiraConfig()) {
  const link = created?._links?.web;
  // Compare against the SITE url, not the API base: on the gateway the API base
  // is api.atlassian.com, while the customer-facing link is on the site host.
  // Anything that is not on our own site is discarded rather than handed to a
  // browser.
  if (typeof link === 'string' && config.siteUrl && isOnHost(link, config.siteUrl)) return link;
  return config.portalUrl || null;
}

function isOnHost(candidate, expectedBase) {
  try {
    return new URL(candidate).host === new URL(expectedBase).host;
  } catch {
    return false;
  }
}
