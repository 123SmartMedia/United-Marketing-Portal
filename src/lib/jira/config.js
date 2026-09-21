/**
 * Jira Service Management configuration.
 * ---------------------------------------
 * Every value comes from the server-side environment. Nothing here may be
 * imported from a client component.
 *
 * TWO AUTHENTICATION MODES, chosen explicitly — never guessed:
 *
 *  scoped_token (intended production mode)
 *    An Atlassian organization service account with a SCOPED API token. Scoped
 *    tokens only work through the Platform API Gateway, so the API base becomes
 *    https://api.atlassian.com/ex/jira/{cloudId} and the credential is sent as
 *    `Authorization: Bearer <token>`. No email is involved.
 *
 *  site_basic (legacy alternative)
 *    A classic unscoped API token belonging to an Atlassian account, sent as
 *    HTTP Basic `email:token` directly against the site URL.
 *
 * JIRA_SITE_URL stays separate from the API base in both modes: it is the
 * human-facing host used for portal links, and it is what a returned
 * `_links.web` must match before we hand it to a browser.
 *
 * JIRA_AUTH_MODE has no default. An unset or unrecognized value leaves the
 * integration unconfigured rather than silently picking a mode.
 */

// Env values pasted into a dashboard can pick up stray whitespace or an
// accidental duplicate line. Take the first non-empty line, trimmed.
// (Same hardening used by the R2 upload route.)
export const cleanEnv = (value) =>
  (value || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';

export const AUTH_MODES = Object.freeze({
  SCOPED_TOKEN: 'scoped_token',
  SITE_BASIC: 'site_basic',
});

export const REPORTER_MODES = Object.freeze({
  SERVICE_ACCOUNT: 'service_account',
  ON_BEHALF_OF: 'on_behalf_of',
});

/** Atlassian Platform API Gateway host for scoped tokens. */
export const ATLASSIAN_GATEWAY = 'https://api.atlassian.com';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PORTAL_URL = 'https://unitedmortgage.atlassian.net/servicedesk/customer/portal/68';

function positiveInt(value, fallback) {
  const n = Number.parseInt(cleanEnv(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Read the full Jira configuration from process.env. Never memoized — Vercel
 *  re-reads env per lambda cold start, and tests need to vary it. */
export function getJiraConfig(env = process.env) {
  // JIRA_BASE_URL is the pre-hardening name, kept as a back-compat alias.
  const siteUrl = (cleanEnv(env.JIRA_SITE_URL) || cleanEnv(env.JIRA_BASE_URL)).replace(/\/+$/, '');
  const cloudId = cleanEnv(env.JIRA_CLOUD_ID);
  const authModeRaw = cleanEnv(env.JIRA_AUTH_MODE);
  const authMode = Object.values(AUTH_MODES).includes(authModeRaw) ? authModeRaw : '';

  const reporterModeRaw = cleanEnv(env.JIRA_REPORTER_MODE) || REPORTER_MODES.SERVICE_ACCOUNT;

  return {
    authMode,
    // Human-facing host. Portal links and returned web links are checked against it.
    siteUrl,
    cloudId,
    // Where REST calls actually go.
    apiBaseUrl: buildApiBaseUrl({ authMode, siteUrl, cloudId }),
    // Read but never returned to anything that serializes to the client.
    token: cleanEnv(env.JIRA_API_TOKEN),
    // Only meaningful in site_basic mode.
    serviceAccountEmail: cleanEnv(env.JIRA_SERVICE_ACCOUNT_EMAIL) || cleanEnv(env.JIRA_API_EMAIL),
    serviceDeskId: cleanEnv(env.JIRA_SERVICE_DESK_ID),
    requestTypeId: cleanEnv(env.JIRA_REQUEST_TYPE_ID),
    portalUrl: cleanEnv(env.JIRA_PORTAL_URL) || DEFAULT_PORTAL_URL,
    reporterMode:
      reporterModeRaw === REPORTER_MODES.ON_BEHALF_OF
        ? REPORTER_MODES.ON_BEHALF_OF
        : REPORTER_MODES.SERVICE_ACCOUNT,
    // Only these email domains may ever be used as a Jira reporter. Guards against
    // a browser-submitted address impersonating an arbitrary Jira customer.
    allowedReporterDomains: parseDomainList(env.JIRA_ALLOWED_REPORTER_DOMAINS),
    attachmentsEnabled: cleanEnv(env.JIRA_ATTACHMENTS_ENABLED) !== 'false',
    // Explicit, disclosed opt-in only. Off by default: a Jira failure must not
    // silently reroute the request to the old email destination.
    emailFallbackEnabled: cleanEnv(env.JIRA_EMAIL_FALLBACK) === 'true',
    // Courtesy acknowledgment to the submitter (preserves today's behavior).
    ackEmailEnabled: cleanEnv(env.JIRA_ACK_EMAIL) !== 'false',
    timeoutMs: positiveInt(env.JIRA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

/** Comma-separated domain list -> lowercase array, '@' tolerated. */
export function parseDomainList(raw) {
  return cleanEnv(raw)
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/**
 * The REST base URL for the selected mode.
 *  - scoped_token -> https://api.atlassian.com/ex/jira/{cloudId}
 *  - site_basic   -> the site URL itself
 * Returns '' when the mode's prerequisites are missing, so nothing falls back to
 * a host we did not explicitly configure.
 */
export function buildApiBaseUrl({ authMode, siteUrl, cloudId }) {
  if (authMode === AUTH_MODES.SCOPED_TOKEN) {
    return cloudId ? `${ATLASSIAN_GATEWAY}/ex/jira/${encodeURIComponent(cloudId)}` : '';
  }
  if (authMode === AUTH_MODES.SITE_BASIC) {
    return siteUrl || '';
  }
  return '';
}

/**
 * The Authorization header value for the selected mode, or null when the
 * credential set is incomplete. Kept here so the route, the discovery script and
 * the smoke test all derive auth the same way.
 *
 * Never log, serialize or return the result.
 */
export function buildAuthHeader(config) {
  if (config.authMode === AUTH_MODES.SCOPED_TOKEN) {
    // Scoped service-account tokens are bearer credentials on the gateway.
    return config.token ? `Bearer ${config.token}` : null;
  }
  if (config.authMode === AUTH_MODES.SITE_BASIC) {
    if (!config.token || !config.serviceAccountEmail) return null;
    return `Basic ${Buffer.from(`${config.serviceAccountEmail}:${config.token}`).toString('base64')}`;
  }
  return null;
}

/**
 * Env vars that are missing for the selected mode — for server logs only, never
 * the client. An unset JIRA_AUTH_MODE is reported first, because nothing else
 * can be validated until the mode is known.
 */
export function missingJiraConfig(config = getJiraConfig()) {
  if (!config.authMode) return ['JIRA_AUTH_MODE'];

  const required = [
    ['JIRA_SITE_URL', config.siteUrl],
    ['JIRA_API_TOKEN', config.token],
    ['JIRA_SERVICE_DESK_ID', config.serviceDeskId],
    ['JIRA_REQUEST_TYPE_ID', config.requestTypeId],
  ];

  if (config.authMode === AUTH_MODES.SCOPED_TOKEN) {
    required.push(['JIRA_CLOUD_ID', config.cloudId]);
  } else {
    required.push(['JIRA_SERVICE_ACCOUNT_EMAIL', config.serviceAccountEmail]);
  }

  return required.filter(([, value]) => !value).map(([name]) => name);
}

/** True when enough is configured to create a request. */
export function isJiraConfigured(config = getJiraConfig()) {
  return missingJiraConfig(config).length === 0 && Boolean(config.apiBaseUrl);
}

/** Is this email allowed to be used as a Jira reporter? */
export function isAllowedReporterEmail(email, config = getJiraConfig()) {
  if (config.reporterMode !== REPORTER_MODES.ON_BEHALF_OF) return false;
  if (typeof email !== 'string') return false;
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  // An empty allow-list means on-behalf-of is effectively disabled: we never
  // let an unauthenticated browser pick an arbitrary Jira customer.
  return config.allowedReporterDomains.includes(domain);
}

/**
 * Server-side gate on who may submit at all. `/custom-requests` is public and
 * unauthenticated, so the HTML `type="email"` field proves nothing; this is the
 * check that actually holds. An empty list allows any domain (local dev) — the
 * production value is documented in .env.example and docs/jira-integration.md.
 */
export function isAllowedSubmitterEmail(email, env = process.env) {
  const allowed = parseDomainList(env.ALLOWED_REQUEST_EMAIL_DOMAINS);
  if (!allowed.length) return true;
  if (typeof email !== 'string') return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return Boolean(domain) && allowed.includes(domain);
}
