import 'server-only';

import {
  createRequest,
  findCustomerAccountId,
  requestWebUrl,
  JiraError,
  JIRA_ERRORS,
} from './client.js';
import { getJiraConfig, isJiraConfigured, isAllowedReporterEmail, REPORTER_MODES } from './config.js';
import { buildRequestFieldValues } from './fieldMap.js';
import { validateAttachments, attachFilesToRequest } from './attachments.js';
import { resolveRequestTypeId, ROUTING_REASONS } from './requestTypeRouting.js';
import { logRejection, ROUTES as LOG_ROUTES, STAGES } from '../observability.js';

/**
 * Orchestrates one marketing request: UMC submission -> Jira Service Management.
 *
 * Returns a normalized result. Nothing here returns a raw Jira response, a Jira
 * field ID, or anything derived from the credentials — the route serializes this
 * object straight to the browser.
 */

/**
 * Decide who Jira should record as the reporter.
 *
 * The /custom-requests page is unauthenticated, so the email in the payload is
 * user-editable and can never be trusted to select an arbitrary Jira customer.
 * `on_behalf_of` is therefore gated twice: the mode must be enabled AND the
 * address must sit in JIRA_ALLOWED_REPORTER_DOMAINS. Even then we only match an
 * existing customer — no account is ever created or invited implicitly.
 */
export async function resolveReporter(submission, config) {
  if (config.reporterMode !== REPORTER_MODES.ON_BEHALF_OF) {
    return { accountId: null, mode: REPORTER_MODES.SERVICE_ACCOUNT, reason: 'mode_service_account' };
  }
  if (!isAllowedReporterEmail(submission.email, config)) {
    return { accountId: null, mode: REPORTER_MODES.SERVICE_ACCOUNT, reason: 'domain_not_allowed' };
  }
  const accountId = await findCustomerAccountId(config.serviceDeskId, submission.email, { config });
  if (!accountId) {
    return { accountId: null, mode: REPORTER_MODES.SERVICE_ACCOUNT, reason: 'customer_not_found' };
  }
  return { accountId, mode: REPORTER_MODES.ON_BEHALF_OF, reason: 'matched_customer' };
}

/**
 * Create the Jira request.
 *
 * @param {object} submission  already validated against requestSchema/simpleSchema
 * @param {object} options     { correlationId, submittedFrom, config, env }
 * @returns {Promise<{ok: boolean, ...}>}
 */
export async function submitJiraRequest(
  submission,
  {
    correlationId,
    submittedFrom,
    config = getJiraConfig(),
    env = process.env,
    uploadsConfig,
    r2Client,
    // The two-stage flow (`/api/jira/requests/finalize`) owns attachment upload,
    // retry and R2 cleanup itself, because it must also delete every staged
    // object when creation fails. It passes true so this function creates the
    // request and stops there.
    skipAttachments = false,
  } = {}
) {
  if (!isJiraConfigured(config)) {
    return { ok: false, error: JIRA_ERRORS.NOT_CONFIGURED };
  }

  // 1. Attachments: validate metadata before anything is created in Jira.
  const attachmentCheck = validateAttachments(submission.files);
  if (!attachmentCheck.ok) {
    return {
      ok: false,
      error: 'attachment_rejected',
      attachmentError: attachmentCheck.error,
      fileName: attachmentCheck.fileName,
    };
  }
  const files = attachmentCheck.files;

  // 2. Reporter identity.
  const reporter = await resolveReporter(submission, config);

  // 3. Field mapping. The description lists attachment filenames and sizes so
  //    the desk can see what was meant to arrive — but never an object key or a
  //    link, because the staged objects are private and short-lived.
  const { requestFieldValues, mapped, unmapped } = buildRequestFieldValues(submission, {
    env,
    attachments: files,
    correlationId,
    submittedFrom,
  });

  // Route to the request type that matches the submitted category, so work lands
  // in the right portal queue. The category is the validated enum value; no Jira
  // request type ID is ever read from the browser.
  const routing = resolveRequestTypeId(submission.requestType, {
    env,
    defaultRequestTypeId: config.requestTypeId,
  });

  if (routing.fallback) {
    // Safe to log: a route name, an env var NAME and a reason code. No form
    // content, no personal data, no credential.
    logRejection({
      route: LOG_ROUTES.SUBMIT,
      stage: STAGES.JIRA_CONFIGURATION,
      category: `request_type_${routing.reason}`,
      status: 200,
      correlationId,
      outcome: `fell_back_to_default_request_type:${routing.route}`,
      missingEnv:
        routing.reason === ROUTING_REASONS.ROUTE_NOT_CONFIGURED ? [routing.envVar] : undefined,
    });
  }

  const payload = {
    serviceDeskId: config.serviceDeskId,
    // Never `body.requestTypeId` — always the environment, selected by route.
    requestTypeId: routing.requestTypeId || config.requestTypeId,
    requestFieldValues,
  };
  if (reporter.accountId) payload.raiseOnBehalfOf = reporter.accountId;

  // 4. Create.
  let created;
  try {
    created = await createRequest(payload, { config });
  } catch (err) {
    const jiraError = err instanceof JiraError ? err : new JiraError(JIRA_ERRORS.NETWORK, { detail: err?.message });
    console.error('[jira] request creation failed', {
      correlationId,
      code: jiraError.code,
      status: jiraError.status,
      // Detail is a short excerpt of Jira's error body — no credentials, no
      // submission content.
      detail: jiraError.detail,
      mappedFieldCount: mapped.length,
      unmappedFields: unmapped,
    });
    return {
      ok: false,
      error: jiraError.code,
      status: jiraError.status,
      fieldErrors: jiraError.fieldErrors,
    };
  }

  const issueKey = created?.issueKey;
  if (!issueKey) {
    console.error('[jira] request created without an issueKey', { correlationId });
    return { ok: false, error: JIRA_ERRORS.UNAVAILABLE };
  }

  // 5. Attachments — Jira's supported order is create-then-attach, so this runs
  //    only after the request exists. Best effort: a failure here leaves a valid
  //    ticket and is reported as a partial success, never as a silent full one.
  let attachmentResult = { attached: 0, failed: 0, error: null };
  if (files.length && !skipAttachments) {
    attachmentResult = await attachFilesToRequest(issueKey, files, { config, uploadsConfig, r2Client });
  }

  console.info('[jira] request created', {
    correlationId,
    issueKey,
    reporterMode: reporter.mode,
    reporterReason: reporter.reason,
    requestTypeRoute: routing.route,
    requestTypeFallback: routing.fallback,
    mappedFieldCount: mapped.length,
    unmappedFields: unmapped,
    attachmentsTotal: files.length,
    attachmentsAttached: attachmentResult.attached,
    attachmentsFailed: files.length - attachmentResult.attached,
  });

  return {
    ok: true,
    issueKey,
    webUrl: requestWebUrl(created, config),
    portalUrl: config.portalUrl,
    attachments: {
      // `total` lets the UI say "2 of 3 attached" instead of implying they all landed.
      total: files.length,
      attached: attachmentResult.attached,
      failed: files.length - attachmentResult.attached,
      warning: attachmentResult.error,
    },
  };
}
