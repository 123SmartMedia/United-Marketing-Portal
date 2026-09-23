/**
 * Website category -> Jira request type.
 * ---------------------------------------
 * The UMC form offers six categories; service desk 68 offers eight portal-visible
 * request types. Routing each category to the right one puts work in the right
 * portal queue instead of dumping everything into "Other".
 *
 * ## The routing key is never supplied by the browser
 *
 * Nothing here reads a Jira request type ID from the request body, and nothing
 * upstream passes one. The only input is `requestType`, which has already been
 * validated against the `REQUEST_TYPES` enum in requestSchema.js — so an
 * attacker cannot aim a submission at an arbitrary request type, and an unknown
 * value routes to the default rather than being trusted.
 *
 * The ID itself always comes from the environment.
 *
 * ## Why this is cheap
 *
 * Discovery confirmed that request types 116, 117 and 123 are field-identical:
 * same fields, same `summary`-only requirement, attachments enabled on all
 * three, and all accept `customfield_10301`. Routing therefore changes which
 * queue a ticket lands in and nothing else — no payload shape changes, and no
 * category can produce a field error another would not.
 *
 * ## Failure behaviour
 *
 * A missing or malformed routing variable falls back to `JIRA_REQUEST_TYPE_ID`
 * and logs a safe warning. Falling back is always correct: the default is a real
 * portal-visible request type with the same fields, so a misconfiguration
 * degrades routing quality without ever losing a submission.
 */

/** Routes, each backed by its own optional environment variable. */
export const ROUTES = Object.freeze({
  PRINT: 'print',
  DIGITAL: 'digital',
  GENERAL: 'general',
});

/** The env var that supplies each route's request type ID. */
export const ROUTE_ENV_VARS = Object.freeze({
  [ROUTES.PRINT]: 'JIRA_REQUEST_TYPE_PRINT',
  [ROUTES.DIGITAL]: 'JIRA_REQUEST_TYPE_DIGITAL',
  [ROUTES.GENERAL]: 'JIRA_REQUEST_TYPE_ID',
});

/**
 * Website category -> route. Keys are the exact `REQUEST_TYPES` values from
 * requestSchema.js; a mismatch here would silently send everything to the
 * default, so a test asserts every enum member is covered.
 */
export const CATEGORY_ROUTES = Object.freeze({
  'Business Cards': ROUTES.PRINT,
  'Letterhead / Stationery': ROUTES.PRINT,
  'Co-branded Flyer / Folder': ROUTES.PRINT,
  'Print Order (Banner, Yard Sign, Door Hanger)': ROUTES.PRINT,
  'Digital Asset Creation': ROUTES.DIGITAL,
  'Custom / Other': ROUTES.GENERAL,
});

/** Reasons a resolution fell back, for safe logging. Never includes form data. */
export const ROUTING_REASONS = Object.freeze({
  ROUTED: 'routed',
  UNKNOWN_CATEGORY: 'unknown_category',
  ROUTE_NOT_CONFIGURED: 'route_not_configured',
  ROUTE_INVALID: 'route_invalid',
  DEFAULT_INVALID: 'default_invalid',
});

const cleanEnv = (value) =>
  (value || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';

/**
 * A Jira request type ID is a positive integer in string form. Anything else —
 * a name, a URL, an empty string, a pasted label — is refused rather than sent
 * to Jira to be rejected there.
 */
export function isValidRequestTypeId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value.trim());
}

/**
 * Resolve the Jira request type ID for a validated website category.
 *
 * @param {string} requestType  a validated REQUEST_TYPES value
 * @param {object} options      { env, defaultRequestTypeId }
 * @returns {{ requestTypeId: string|null, route: string, fallback: boolean, reason: string, envVar: string }}
 *          `requestTypeId` is null only when the default itself is unusable,
 *          which the caller already guards against via missingJiraConfig().
 */
export function resolveRequestTypeId(requestType, { env = process.env, defaultRequestTypeId } = {}) {
  const fallbackId = cleanEnv(defaultRequestTypeId ?? env.JIRA_REQUEST_TYPE_ID);
  const fallbackUsable = isValidRequestTypeId(fallbackId);

  const route = CATEGORY_ROUTES[requestType];

  // An unrecognized category (the lightweight inline forms send their own
  // wording) is not an error — it routes to the default.
  if (!route) {
    return {
      requestTypeId: fallbackUsable ? fallbackId : null,
      route: ROUTES.GENERAL,
      fallback: true,
      reason: requestType ? ROUTING_REASONS.UNKNOWN_CATEGORY : ROUTING_REASONS.UNKNOWN_CATEGORY,
      envVar: ROUTE_ENV_VARS[ROUTES.GENERAL],
    };
  }

  // The general route IS the default; there is nothing to fall back from.
  if (route === ROUTES.GENERAL) {
    return {
      requestTypeId: fallbackUsable ? fallbackId : null,
      route,
      fallback: !fallbackUsable,
      reason: fallbackUsable ? ROUTING_REASONS.ROUTED : ROUTING_REASONS.DEFAULT_INVALID,
      envVar: ROUTE_ENV_VARS[ROUTES.GENERAL],
    };
  }

  const envVar = ROUTE_ENV_VARS[route];
  const configured = cleanEnv(env[envVar]);

  if (!configured) {
    return {
      requestTypeId: fallbackUsable ? fallbackId : null,
      route,
      fallback: true,
      reason: ROUTING_REASONS.ROUTE_NOT_CONFIGURED,
      envVar,
    };
  }
  if (!isValidRequestTypeId(configured)) {
    return {
      requestTypeId: fallbackUsable ? fallbackId : null,
      route,
      fallback: true,
      reason: ROUTING_REASONS.ROUTE_INVALID,
      envVar,
    };
  }

  return {
    requestTypeId: configured.trim(),
    route,
    fallback: false,
    reason: ROUTING_REASONS.ROUTED,
    envVar,
  };
}
