/**
 * Structured server logging for the request pipeline.
 * ----------------------------------------------------
 * Every failure a user can be shown emits exactly one JSON line carrying the
 * safe Reference ID they see, so an operator handed only that ID can find the
 * route, the stage, the internal error category, the HTTP status, the upstream
 * status where safe, and the deployment it happened on.
 *
 * Before this existed, failures logged ad-hoc prefixed strings with
 * inconsistent fields — the correlation id was there, but nothing said which
 * stage failed, what status the user got, or which deployment served it. Two
 * call sites also logged a submitted filename.
 *
 * ## What may never be logged
 *
 * This module is an allow-list, not a convention. `logFailure` copies only the
 * fields named in `SAFE_FIELDS`; anything else passed in is dropped rather than
 * serialized. That makes it structurally impossible to leak, by accident or by
 * a later careless edit:
 *
 *   - submitted form content (names, emails, phone numbers, message bodies)
 *   - attachment filenames
 *   - Turnstile tokens, finalize tokens, Jira tokens, R2 credentials
 *   - Authorization headers, presigned URLs, R2 object keys, bucket names
 *
 * Environment variable NAMES are allowed (`missingEnv`); values never are.
 */

/** Routes, named once so a typo cannot fragment a query. */
export const ROUTES = Object.freeze({
  INIT: '/api/jira/requests/init',
  FINALIZE: '/api/jira/requests/finalize',
  SUBMIT: '/api/jira/requests',
  UPLOAD_URL: '/api/upload-url',
});

/**
 * Pipeline stages, in the order a request passes through them. The stage is the
 * single most useful field: it turns "submission failed" into "failed at the
 * Jira configuration check, before anything was created".
 */
export const STAGES = Object.freeze({
  ORIGIN_CHECK: 'origin_check',
  BODY_PARSE: 'body_parse',
  RATE_LIMIT: 'rate_limit',
  FORM_VALIDATION: 'form_validation',
  ATTACHMENT_VALIDATION: 'attachment_validation',
  EMAIL_DOMAIN_VALIDATION: 'email_domain_validation',
  TURNSTILE_VALIDATION: 'turnstile_validation',
  UPLOAD_CONFIGURATION: 'upload_configuration',
  FINALIZE_TOKEN_SIGNING: 'finalize_token_signing',
  FINALIZE_TOKEN_VERIFICATION: 'finalize_token_verification',
  PAYLOAD_HASH_VERIFICATION: 'payload_hash_verification',
  OBJECT_KEY_VERIFICATION: 'object_key_verification',
  R2_PRESIGN: 'r2_presign',
  R2_VERIFICATION: 'r2_verification',
  JIRA_CONFIGURATION: 'jira_configuration',
  JIRA_REQUEST_CREATION: 'jira_request_creation',
  JIRA_ATTACHMENT: 'jira_attachment',
  IDEMPOTENCY: 'idempotency',
  ACKNOWLEDGMENT_EMAIL: 'acknowledgment_email',
  UNHANDLED: 'unhandled',
});

/**
 * The only keys that are ever serialized. Anything else is dropped.
 * Deliberately absent: fileName, email, name, token, key, bucket, url.
 */
const SAFE_FIELDS = Object.freeze([
  'route',
  'stage',
  'category',
  'status',
  'upstreamStatus',
  'correlationId',
  'requestId',
  'missingEnv',
  'attempts',
  'fileCount',
  'attachedCount',
  'failedCount',
  'outcome',
  'reason',
  'duplicate',
]);

/**
 * Which deployment served the request. Vercel populates these at runtime; they
 * are absent locally, and an absent field is simply omitted.
 */
export function deploymentInfo(env = process.env) {
  const info = {
    id: env.VERCEL_DEPLOYMENT_ID || undefined,
    env: env.VERCEL_ENV || env.NODE_ENV || undefined,
    // Short commit sha is enough to identify the build and is not sensitive.
    commit: env.VERCEL_GIT_COMMIT_SHA ? String(env.VERCEL_GIT_COMMIT_SHA).slice(0, 7) : undefined,
    region: env.VERCEL_REGION || undefined,
  };
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined));
}

/**
 * `reason` is the one free-text field, so it is the one that could carry
 * something it shouldn't. It is truncated, and anything that looks like a
 * credential, a URL or an object key is replaced outright.
 */
export function sanitizeReason(value) {
  if (value === null || value === undefined) return undefined;
  let text = String(value).slice(0, 200);
  if (/https?:\/\//i.test(text)) return 'redacted_url';
  if (/marketing-requests\/|requests\/\d{4}-/.test(text)) return 'redacted_object_key';
  if (/bearer\s|basic\s|x-amz-|authorization/i.test(text)) return 'redacted_credential';
  if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return 'redacted_email';
  return text;
}

function buildEntry(level, fields) {
  const entry = { level, event: 'request_failure', ts: new Date().toISOString() };

  for (const key of SAFE_FIELDS) {
    const value = fields[key];
    if (value === undefined || value === null) continue;
    entry[key] = key === 'reason' ? sanitizeReason(value) : value;
  }

  const deployment = deploymentInfo();
  if (Object.keys(deployment).length) entry.deployment = deployment;
  return entry;
}

/**
 * Log one user-visible failure.
 *
 * @param {object} fields
 *   route          one of ROUTES
 *   stage          one of STAGES — where in the pipeline it stopped
 *   category       the internal error code (e.g. 'jira_not_configured')
 *   status         the HTTP status the user received
 *   upstreamStatus the status Jira/Cloudflare returned, when safe to record
 *   correlationId  the safe Reference ID shown to the user
 *   missingEnv     array of env var NAMES that are unset — never values
 */
export function logFailure(fields = {}) {
  console.error(JSON.stringify(buildEntry('error', fields)));
}

/** Same shape, for rejections that are expected rather than faults. */
export function logRejection(fields = {}) {
  console.warn(JSON.stringify({ ...buildEntry('warn', fields), event: 'request_rejected' }));
}

/** Same shape, for a completed submission. */
export function logSuccess(fields = {}) {
  console.info(JSON.stringify({ ...buildEntry('info', fields), event: 'request_succeeded' }));
}

/** Exposed for tests — the allow-list is the security control here. */
export const __SAFE_FIELDS = SAFE_FIELDS;
