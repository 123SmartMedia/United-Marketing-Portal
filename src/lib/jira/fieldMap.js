/**
 * The single source of truth for UMC form field -> Jira field translation.
 * ------------------------------------------------------------------------
 * No Jira field ID appears anywhere else in the codebase, and none appears in a
 * UI component. Every structured Jira target is read from the environment at
 * request time, because the real `customfield_#####` IDs are instance-specific
 * and must be discovered (`npm run jira:discover`) rather than guessed.
 *
 * Contract:
 *  - `summary` and `description` are standard Jira fields and are always sent.
 *  - Every other UMC field is OPTIONAL to map. When its env var is unset the
 *    value is still delivered inside the description, so no submitted data is
 *    ever silently dropped.
 *  - `select` / `yesno` fields send an option ID when one is configured in
 *    JIRA_FIELD_OPTIONS, otherwise they send `{ value: "<label>" }`, which Jira
 *    resolves by option name.
 *
 * This module is intentionally free of secrets, I/O and `server-only` so it can
 * be unit tested directly.
 */

/** Jira's own standard fields. Never env-configurable. */
export const STANDARD_FIELDS = Object.freeze({
  SUMMARY: 'summary',
  DESCRIPTION: 'description',
});

const MAX_SUMMARY_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 30000;

/**
 * Ordered field definitions. `key` matches the UMC form/schema field name.
 *  - `label`   human label used in the generated description
 *  - `type`    text | textarea | select | yesno | date | boolean
 *  - `envVar`  env var holding the Jira field ID (customfield_#####) — optional
 *  - `section` grouping in the generated description
 */
export const FIELD_DEFINITIONS = Object.freeze([
  { key: 'requestType', label: 'Request type', type: 'select', envVar: 'JIRA_FIELD_REQUEST_TYPE', section: 'Request' },
  { key: 'rush', label: 'Rush request', type: 'boolean', envVar: 'JIRA_FIELD_RUSH', section: 'Request' },
  { key: 'dateNeeded', label: 'Date needed by', type: 'date', envVar: 'JIRA_FIELD_DATE_NEEDED', section: 'Request' },

  { key: 'name', label: 'Requester name', type: 'text', envVar: 'JIRA_FIELD_REQUESTER_NAME', section: 'Requester' },
  { key: 'email', label: 'Requester email', type: 'text', envVar: 'JIRA_FIELD_REQUESTER_EMAIL', section: 'Requester' },
  { key: 'phone', label: 'Phone', type: 'text', envVar: 'JIRA_FIELD_REQUESTER_PHONE', section: 'Requester' },
  { key: 'nmls', label: 'NMLS ID', type: 'text', envVar: 'JIRA_FIELD_NMLS', section: 'Requester' },
  { key: 'branch', label: 'Branch / office', type: 'text', envVar: 'JIRA_FIELD_BRANCH', section: 'Requester' },

  { key: 'printingNeeded', label: 'Printing needed', type: 'yesno', envVar: 'JIRA_FIELD_PRINTING_NEEDED', section: 'Print details' },
  { key: 'quantity', label: 'Estimated quantity', type: 'select', envVar: 'JIRA_FIELD_QUANTITY', section: 'Print details' },
  { key: 'size', label: 'Size / format', type: 'select', envVar: 'JIRA_FIELD_SIZE', section: 'Print details' },
  { key: 'finish', label: 'Finish / paper', type: 'select', envVar: 'JIRA_FIELD_FINISH', section: 'Print details' },

  { key: 'cobrand', label: 'Co-branding with a partner', type: 'yesno', envVar: 'JIRA_FIELD_COBRAND', section: 'Co-branding' },
  { key: 'partnerName', label: 'Partner company', type: 'text', envVar: 'JIRA_FIELD_PARTNER_NAME', section: 'Co-branding' },
  { key: 'complianceApproved', label: 'Compliance confirmed', type: 'boolean', envVar: 'JIRA_FIELD_COMPLIANCE_APPROVED', section: 'Co-branding' },

  // projectTitle also becomes the Jira summary; it stays in the description too
  // so a truncated summary never loses the original wording.
  { key: 'projectTitle', label: 'Project title', type: 'text', envVar: 'JIRA_FIELD_PROJECT_TITLE', section: 'Creative' },
  { key: 'keyMessage', label: 'Key message / CTA', type: 'textarea', envVar: 'JIRA_FIELD_KEY_MESSAGE', section: 'Creative' },
  { key: 'additionalDetails', label: 'Additional details', type: 'textarea', envVar: 'JIRA_FIELD_ADDITIONAL_DETAILS', section: 'Creative' },

  // Only sent by the lightweight inline forms (category CTA / Get Started).
  { key: 'asset', label: 'Related asset', type: 'text', envVar: 'JIRA_FIELD_ASSET', section: 'Creative' },
  { key: 'details', label: 'Details', type: 'textarea', envVar: 'JIRA_FIELD_DETAILS', section: 'Creative' },
]);

const SECTION_ORDER = ['Request', 'Requester', 'Print details', 'Co-branding', 'Creative'];

/** Parse JIRA_FIELD_OPTIONS, e.g. {"requestType":{"Business Cards":"10234"}}. */
export function parseOptionMap(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A malformed map must not take the form down: fall back to sending option
    // labels by value. The caller logs the gap server-side.
    return {};
  }
}

/** Collapse whitespace and trim. Newlines survive in multiline values. */
export function normalizeText(value, { multiline = false } = {}) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (multiline) {
    return str
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return str.replace(/\s+/g, ' ').trim();
}

/** Human-readable value for the description block. */
function displayValue(def, raw) {
  if (def.type === 'boolean') return raw ? 'Yes' : '';
  return normalizeText(raw, { multiline: def.type === 'textarea' });
}

/**
 * Value shaped for Jira's requestFieldValues, or undefined when the field
 * should not be sent as a structured field.
 */
function structuredValue(def, raw, optionMap) {
  switch (def.type) {
    case 'text':
    case 'textarea': {
      const text = normalizeText(raw, { multiline: def.type === 'textarea' });
      return text || undefined;
    }
    case 'date': {
      const text = normalizeText(raw);
      // Jira date fields want a bare YYYY-MM-DD.
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
    }
    case 'boolean':
    case 'yesno':
    case 'select': {
      const label = def.type === 'boolean' ? (raw ? 'Yes' : '') : normalizeText(raw);
      if (!label) return undefined;
      const optionId = optionMap?.[def.key]?.[label];
      return optionId ? { id: String(optionId) } : { value: label };
    }
    default:
      return undefined;
  }
}

/** Jira summary: "[RUSH] <project title> — <requester>", truncated safely. */
export function buildSummary(submission) {
  const title =
    normalizeText(submission.projectTitle) || normalizeText(submission.requestType) || 'Marketing request';
  const who = normalizeText(submission.name);
  const rush = submission.rush ? '[RUSH] ' : '';
  const base = who ? `${rush}${title} — ${who}` : `${rush}${title}`;
  return base.length > MAX_SUMMARY_LENGTH ? `${base.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : base;
}

/**
 * Readable description containing every submitted value, including ones that
 * also went to a structured Jira field. The description is deliberately complete
 * so a Jira admin can always see the raw submission even if a mapping is wrong.
 */
export function buildDescription(submission, { attachments = [], correlationId, submittedFrom } = {}) {
  const lines = [];

  for (const section of SECTION_ORDER) {
    const rows = FIELD_DEFINITIONS.filter((d) => d.section === section)
      .map((def) => [def.label, displayValue(def, submission[def.key])])
      .filter(([, value]) => value);
    if (!rows.length) continue;
    lines.push(`*${section}*`);
    for (const [label, value] of rows) {
      lines.push(value.includes('\n') ? `- ${label}:\n${value}` : `- ${label}: ${value}`);
    }
    lines.push('');
  }

  if (attachments.length) {
    // Filenames and sizes only. The staged object lives in a private bucket and
    // its key is never written here — a Jira description is read by more people
    // than the submitter, and a durable pointer to the raw object would outlive
    // the short retention window it is meant to have.
    lines.push(`*Attachments (${attachments.length})*`);
    for (const file of attachments) {
      const kb = Math.round((file.size || 0) / 1024);
      lines.push(`- ${file.name} (${kb} KB)`);
    }
    lines.push('');
  }

  lines.push('----');
  lines.push(`Submitted via ${submittedFrom || 'marketing.unitedmortgage.com'}`);
  if (correlationId) lines.push(`Correlation ID: ${correlationId}`);

  const text = lines.join('\n').trim();
  return text.length > MAX_DESCRIPTION_LENGTH
    ? `${text.slice(0, MAX_DESCRIPTION_LENGTH - 20)}\n…(truncated)`
    : text;
}

/**
 * Build the full `requestFieldValues` payload.
 * Returns { requestFieldValues, mapped, unmapped } — `unmapped` lists the UMC
 * fields that carried a value but had no Jira field configured, so the caller
 * can log (never expose) the gap.
 */
export function buildRequestFieldValues(
  submission,
  { env = process.env, attachments = [], correlationId, submittedFrom } = {}
) {
  const optionMap = parseOptionMap(env.JIRA_FIELD_OPTIONS);
  const requestFieldValues = {
    [STANDARD_FIELDS.SUMMARY]: buildSummary(submission),
    [STANDARD_FIELDS.DESCRIPTION]: buildDescription(submission, {
      attachments,
      correlationId,
      submittedFrom,
    }),
  };

  const mapped = [];
  const unmapped = [];

  for (const def of FIELD_DEFINITIONS) {
    if (!displayValue(def, submission[def.key])) continue;

    const fieldId = (env[def.envVar] || '').trim();
    if (!fieldId) {
      unmapped.push(def.key);
      continue;
    }
    const value = structuredValue(def, submission[def.key], optionMap);
    if (value === undefined) {
      unmapped.push(def.key);
      continue;
    }
    requestFieldValues[fieldId] = value;
    mapped.push({ key: def.key, fieldId });
  }

  return { requestFieldValues, mapped, unmapped };
}
