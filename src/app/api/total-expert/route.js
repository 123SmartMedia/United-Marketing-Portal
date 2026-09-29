import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { totalExpertSchema, toJiraSubmission } from '@/lib/totalExpertSchema';
import { submitJiraRequest } from '@/lib/jira/submitRequest';
import { getJiraConfig, isJiraConfigured, missingJiraConfig, isAllowedSubmitterEmail } from '@/lib/jira/config';
import { verifyTurnstileToken, TURNSTILE_RESULTS } from '@/lib/turnstile';
import { checkRateLimit, clientIp, isSameOrigin } from '@/lib/rateLimit';
import { getIdempotencyStore } from '@/lib/idempotencyStore';
import { deliverSubmission, sendAcknowledgment } from '@/lib/submissions';
import { logFailure, logRejection, logSuccess, STAGES } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Total Expert account sign-up -> Jira Service Management, with email backup.
 *
 * Same gates, in the same cheapest-first order, as /api/jira/requests. The one
 * deliberate difference: when Jira is unconfigured or creation fails, this form
 * ALWAYS falls back to emailing the marketing desk (the business asked for
 * "Jira ticket + email" here), rather than honouring JIRA_EMAIL_FALLBACK.
 *
 * The response carries only { ok, requestKey, requestUrl, fallback } — never a
 * Jira field ID, error body, or credential.
 */

const ROUTE = '/api/total-expert';
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };

const GENERIC =
  'We couldn’t submit your sign-up right now. Your details are still here — please try again, or email marketing@unitedmortgage.com.';

const TURNSTILE_MESSAGES = {
  [TURNSTILE_RESULTS.MISSING]: 'Please complete the “Verify you’re human” challenge before submitting.',
  [TURNSTILE_RESULTS.DUPLICATE]: 'Your verification expired. Please complete the challenge again and resubmit.',
  [TURNSTILE_RESULTS.TIMEOUT]: 'We couldn’t reach the verification service. Please try again in a moment.',
  [TURNSTILE_RESULTS.UNAVAILABLE]: 'We couldn’t reach the verification service. Please try again in a moment.',
};

function reply(status, body, headers) {
  return NextResponse.json(body, { status, headers });
}

export async function POST(request) {
  const correlationId = randomUUID();

  if (!isSameOrigin(request)) {
    return reply(403, { ok: false, error: 'forbidden_origin', message: GENERIC, correlationId });
  }

  const raw = await request.text();
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES || raw.length > MAX_BODY_BYTES) {
    return reply(413, { ok: false, error: 'payload_too_large', message: GENERIC, correlationId });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: 'validation', message: GENERIC, correlationId });
  }

  // Honeypot: accept silently, create nothing.
  if (body?.company) return reply(200, { ok: true, requestKey: null, correlationId });

  const parsed = totalExpertSchema.safeParse(body);
  if (!parsed.success) {
    return reply(400, {
      ok: false,
      error: 'validation',
      message: 'Please check the highlighted fields and try again.',
      correlationId,
      fields: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
  }
  const signup = parsed.data;

  if (!isAllowedSubmitterEmail(signup.email)) {
    logRejection({ route: ROUTE, stage: STAGES.EMAIL_DOMAIN_VALIDATION, category: 'email_domain_not_allowed', status: 403, correlationId });
    return reply(403, {
      ok: false,
      error: 'email_domain_not_allowed',
      message: 'Please use your United Mortgage work email address.',
      correlationId,
      fields: ['email'],
    });
  }

  const submissionId =
    typeof body.submissionId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(body.submissionId) ? body.submissionId : null;

  const store = getIdempotencyStore();
  const cached = store.get(submissionId);
  if (cached) return reply(200, { ...cached, duplicate: true });
  if (!store.claim(submissionId)) {
    return reply(409, { ok: false, error: 'in_progress', message: 'Your sign-up is still being submitted…', correlationId });
  }

  try {
    const ip = clientIp(request);
    const limit = checkRateLimit(`te:${ip}`, RATE_LIMIT);
    if (!limit.allowed) {
      return reply(
        429,
        { ok: false, error: 'rate_limited', message: 'Too many attempts. Please wait a moment and try again.', correlationId },
        { 'Retry-After': String(limit.retryAfterSeconds) }
      );
    }

    const turnstile = await verifyTurnstileToken(body.turnstileToken, {
      remoteIp: ip,
      idempotencyKey: submissionId || correlationId,
    });
    if (!turnstile.ok) {
      const outage = turnstile.result === TURNSTILE_RESULTS.UNAVAILABLE || turnstile.result === TURNSTILE_RESULTS.TIMEOUT;
      const status = outage ? 503 : 400;
      logRejection({ route: ROUTE, stage: STAGES.TURNSTILE_VALIDATION, category: turnstile.result, status, correlationId });
      return reply(status, {
        ok: false,
        error: turnstile.result,
        message:
          TURNSTILE_MESSAGES[turnstile.result] ||
          'We couldn’t verify that submission. Please complete the challenge again and resubmit.',
        correlationId,
        resetChallenge: true,
      });
    }

    const submission = toJiraSubmission(signup);
    const payload = await createTicketOrEmail(submission, { request, correlationId });
    if (!payload) {
      return reply(502, { ok: false, error: 'delivery_failed', message: GENERIC, correlationId });
    }
    store.remember(submissionId, payload);
    return reply(payload.fallback ? 200 : 201, payload);
  } catch (err) {
    logFailure({ route: ROUTE, stage: STAGES.UNHANDLED, category: 'unhandled', status: 500, correlationId, reason: err?.message });
    return reply(500, { ok: false, error: 'unavailable', message: GENERIC, correlationId });
  } finally {
    store.release(submissionId);
  }
}

/**
 * Jira first; the marketing-desk email whenever Jira can't take it. Returns the
 * browser payload, or null when neither channel delivered.
 */
async function createTicketOrEmail(submission, { request, correlationId }) {
  const config = getJiraConfig();

  if (isJiraConfigured(config)) {
    const result = await submitJiraRequest(submission, { correlationId, submittedFrom: new URL(request.url).host });
    if (result.ok) {
      if (config.ackEmailEnabled) {
        try {
          await sendAcknowledgment({ ...submission, requestKey: result.issueKey });
        } catch (err) {
          logFailure({ route: ROUTE, stage: STAGES.ACKNOWLEDGMENT_EMAIL, category: 'ack_email_failed', status: 201, correlationId, reason: err?.message });
        }
      }
      logSuccess({ route: ROUTE, stage: STAGES.JIRA_REQUEST_CREATION, category: 'te_signup_ticket', status: 201, correlationId });
      return { ok: true, requestKey: result.issueKey, requestUrl: result.webUrl, correlationId };
    }
    logFailure({ route: ROUTE, stage: STAGES.JIRA_REQUEST_CREATION, category: result.error, status: 200, upstreamStatus: result.status, correlationId, outcome: 'email_fallback' });
  } else {
    logRejection({ route: ROUTE, stage: STAGES.JIRA_CONFIGURATION, category: 'jira_not_configured', status: 200, correlationId, missingEnv: missingJiraConfig(config), outcome: 'email_fallback' });
  }

  // deliverSubmission emails the desk AND sends the submitter's acknowledgment.
  const delivery = await deliverSubmission(submission);
  if (!delivery.delivered) {
    logFailure({ route: ROUTE, stage: STAGES.JIRA_REQUEST_CREATION, category: 'email_fallback_failed', status: 502, correlationId });
    return null;
  }
  return { ok: true, requestKey: null, requestUrl: null, correlationId, fallback: 'email' };
}
