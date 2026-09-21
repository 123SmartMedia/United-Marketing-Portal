import { JIRA_ERRORS } from './client.js';
import { ATTACHMENT_ERRORS } from './attachments.js';
import { MAX_FILES, MAX_TOTAL_BYTES } from '../requestSchema.js';

/**
 * Translation from internal error codes to what the browser is allowed to see.
 * -----------------------------------------------------------------------------
 * Raw Jira messages, HTTP bodies, field IDs and stack traces never cross this
 * boundary. Authentication, permission, rate-limit and outage failures all
 * collapse into one generic "not submitted" message so the response cannot be
 * used to probe the Jira instance.
 */

const MB = (bytes) => `${Math.round(bytes / 1024 / 1024)}MB`;

const GENERIC =
  'We couldn’t submit your request right now. Your details are still here — please try again in a moment.';

const MESSAGES = {
  [JIRA_ERRORS.NOT_CONFIGURED]:
    'Request submission isn’t available right now. Please email marketing@unitedmortgage.com and we’ll pick it up from there.',
  [JIRA_ERRORS.VALIDATION]:
    'Some details weren’t accepted. Please review your entries and submit again.',
  [JIRA_ERRORS.TIMEOUT]:
    'The request is taking longer than expected and wasn’t submitted. Your details are still here — please try again.',
  [JIRA_ERRORS.PAYLOAD_TOO_LARGE]:
    'Your request is too large to submit. Try removing an attachment and submitting again.',
  // Everything else — auth, permission, not-found, rate limit, outage, network —
  // deliberately shares the generic message.
  [JIRA_ERRORS.AUTH]: GENERIC,
  [JIRA_ERRORS.PERMISSION]: GENERIC,
  [JIRA_ERRORS.NOT_FOUND]: GENERIC,
  [JIRA_ERRORS.RATE_LIMITED]: GENERIC,
  [JIRA_ERRORS.UNAVAILABLE]: GENERIC,
  [JIRA_ERRORS.NETWORK]: GENERIC,
};

const ATTACHMENT_MESSAGES = {
  [ATTACHMENT_ERRORS.TOO_MANY]: `You can attach up to ${MAX_FILES} files.`,
  [ATTACHMENT_ERRORS.TOO_LARGE]: `Total attachment size must stay under ${MB(MAX_TOTAL_BYTES)}.`,
  [ATTACHMENT_ERRORS.UNSUPPORTED_TYPE]: 'Attachments must be PDF, PNG, or JPG files.',
  [ATTACHMENT_ERRORS.INVALID_FILE]: 'One of your attachments couldn’t be read. Please remove it and try again.',
  [ATTACHMENT_ERRORS.UNTRUSTED_SOURCE]:
    'One of your attachments couldn’t be verified. Please remove it, re-upload, and try again.',
};

/** HTTP status for a normalized error code. */
export function statusForError(code) {
  switch (code) {
    case JIRA_ERRORS.NOT_CONFIGURED:
      return 503;
    case JIRA_ERRORS.VALIDATION:
    case 'attachment_rejected':
    case 'validation':
      return 400;
    case JIRA_ERRORS.PAYLOAD_TOO_LARGE:
      return 413;
    case JIRA_ERRORS.TIMEOUT:
      return 504;
    case 'rate_limited':
      return 429;
    default:
      return 502;
  }
}

/** Safe, user-facing message for a normalized error code. */
export function messageForError(code, { attachmentError, fileName } = {}) {
  if (code === 'attachment_rejected') {
    const base = ATTACHMENT_MESSAGES[attachmentError] || 'One of your attachments couldn’t be accepted.';
    return fileName ? `${base} (${fileName})` : base;
  }
  if (code === 'rate_limited') {
    return 'You’ve submitted several requests in a row. Please wait a few minutes before sending another.';
  }
  if (code === 'validation') {
    return 'Please check the highlighted fields and submit again.';
  }
  return MESSAGES[code] || GENERIC;
}

export { GENERIC as GENERIC_ERROR_MESSAGE };
