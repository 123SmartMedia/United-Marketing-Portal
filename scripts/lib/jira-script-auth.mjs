/**
 * Shared authentication for the Jira CLI scripts.
 *
 * Both `jira:discover` and `jira:smoke` resolve credentials through the exact
 * same module the production route uses (src/lib/jira/config.js), so a script
 * can never succeed against a host or an auth mode that the app would not use.
 *
 * Nothing here prints, returns or logs the token itself.
 */

import { readFileSync } from 'node:fs';

import {
  getJiraConfig,
  buildAuthHeader,
  missingJiraConfig,
  AUTH_MODES,
} from '../../src/lib/jira/config.js';

/** Minimal .env.local loader so the scripts work without a dev server. */
export function loadEnvFile(file = '.env.local') {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // No .env.local — rely on the ambient environment.
  }
}

/**
 * Resolve the config and fail loudly if it is incomplete.
 * `extraRequired` lets the smoke test demand the desk/request-type ids that
 * discovery is allowed to run without.
 */
export function resolveScriptConfig({ extraRequired = [] } = {}) {
  const config = getJiraConfig();

  if (!config.authMode) {
    fail(
      'JIRA_AUTH_MODE is not set.\n\n' +
        `  ${AUTH_MODES.SCOPED_TOKEN}  — Atlassian service account with a scoped API token (recommended).\n` +
        `                  Also set JIRA_CLOUD_ID. Calls go to the Platform API Gateway.\n` +
        `  ${AUTH_MODES.SITE_BASIC}     — legacy account + unscoped token against the site directly.\n` +
        '                  Also set JIRA_SERVICE_ACCOUNT_EMAIL.\n\n' +
        'The mode is never guessed. See .env.example and docs/jira-integration.md.'
    );
  }

  // Discovery does not need the desk/request-type ids, so check only the auth
  // prerequisites here and let the caller add the rest.
  const missing = missingJiraConfig(config).filter(
    (name) => !['JIRA_SERVICE_DESK_ID', 'JIRA_REQUEST_TYPE_ID'].includes(name)
  );
  for (const [name, value] of extraRequired) {
    if (!value) missing.push(name);
  }

  if (missing.length) {
    fail(
      `Missing environment variable(s): ${[...new Set(missing)].join(', ')}\n` +
        'Set them in .env.local (see .env.example) or in your shell, then re-run.'
    );
  }

  const authorization = buildAuthHeader(config);
  if (!authorization) {
    fail('Could not build an Authorization header from the configured credentials.');
  }

  return { config, authorization };
}

/** One-line, credential-free summary of how this run will authenticate. */
export function describeConfig(config) {
  const lines = [
    `Auth mode     : ${config.authMode}`,
    `API base      : ${config.apiBaseUrl}`,
    `Site (links)  : ${config.siteUrl}`,
  ];
  if (config.authMode === AUTH_MODES.SCOPED_TOKEN) {
    lines.push(`Cloud ID      : ${config.cloudId}`);
    lines.push('Credential    : scoped API token (bearer, not shown)');
  } else {
    lines.push(`Account       : ${config.serviceAccountEmail}`);
    lines.push('Credential    : API token (basic, not shown)');
  }
  return lines.join('\n');
}

/** Authenticated GET/POST against the configured API base. */
export async function apiFetch(path, { authorization, config, method = 'GET', body, timeoutMs = 20000 } = {}) {
  const headers = { Authorization: authorization, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.body = text.slice(0, 1200);
    throw error;
  }
  return response.json();
}

export function explainStatus(status, config) {
  switch (status) {
    case 401:
      return config?.authMode === AUTH_MODES.SCOPED_TOKEN
        ? 'Authentication failed. Check JIRA_API_TOKEN (a scoped token) and JIRA_CLOUD_ID — a scoped token only works through api.atlassian.com.'
        : 'Authentication failed. Check JIRA_SERVICE_ACCOUNT_EMAIL and JIRA_API_TOKEN (the token must belong to that account).';
    case 403:
      return 'Authenticated, but not permitted. Check the token scopes and the account\'s project access.';
    case 404:
      return config?.authMode === AUTH_MODES.SCOPED_TOKEN
        ? 'Not found. Check JIRA_CLOUD_ID — a wrong cloud id returns 404 from the gateway.'
        : 'Not found. Check JIRA_SITE_URL and the id you passed.';
    case 429:
      return 'Rate limited by Atlassian. Wait a minute and retry.';
    default:
      return `Unexpected response (HTTP ${status}).`;
  }
}

export function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}
