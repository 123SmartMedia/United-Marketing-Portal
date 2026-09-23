import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requestSchema, simpleSchema } from '@/lib/requestSchema';
import { submitJiraRequest } from '@/lib/jira/submitRequest';
import {
  getJiraConfig,
  isJiraConfigured,
  missingJiraConfig,
  isAllowedSubmitterEmail,
} from '@/lib/jira/config';
import { JIRA_ERRORS } from '@/lib/jira/client';
import { messageForError, statusForError } from '@/lib/jira/responseMessages';
import { verifyTurnstileToken, TURNSTILE_RESULTS } from '@/lib/turnstile';
import { checkRateLimit, clientIp, isSameOrigin } from '@/lib/rateLimit';
import { getIdempotencyStore } from '@/lib/idempotencyStore';
import { deliverSubmission, sendAcknowledgment } from '@/lib/submissions';
import { logFailure, logRejection, ROUTES, STAGES } from '@/lib/observability';

export const runtime = 'nodejs';
// Never prerender or cache a submission endpoint.
export const dynamic = 'force-dynamic';

/**
 * Marketing request -> Jira Service Management.
 *
 * Browser (UMC form on /custom-requests)
 *   -> POST /api/jira/requests   (same-origin, Turnstile-gated, validated, throttled)
 *   -> POST /rest/servicedeskapi/request
 *
 * Order matters. Cheap, local rejections come first; then the Turnstile
 * redemption and the submitter allow-list; only then does anything touch
 * Cloudflare R2 or Jira. Nothing that costs an external call runs for a request
 * that was never going to be accepted.
 *
 * All Jira communication happens here, server-side. The response carries only a
 * normalized result: no Jira field IDs, no Jira error bodies, no R2 object keys,
 * no credentials.
 *
 * Only POST is exported, so every other method gets a 405 from Next.js.
 */

const MAX_BODY_BYTES = 128 * 1024; // the payload is metadata only; files live in R2
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };

/** Turnstile outcomes that deserve their own wording. */
const TURNSTILE_MESSAGES = {
  [TURNSTILE_RESULTS.MISSING]:
    'Please complete the “Verify you’re human” challenge before submitting.',
  [TURNSTILE_RESULTS.DUPLICATE]:
    'Your verification expired. Please complete the challenge again and resubmit.',
  [TURNSTILE_RESULTS.TIMEOUT]:
    'We couldn’t reach the verification service. Please try again in a moment.',
  [TURNSTILE_RESULTS.UNAVAILABLE]:
    'We couldn’t reach the verification service. Please try again in a moment.',
};
const TURNSTILE_GENERIC =
  'We couldn’t verify that submission. Please complete the challenge again and resubmit.';

function fail(code, { correlationId, status, message, ...extra } = {}) {
  return NextResponse.json(
    {
      ok: false,
      error: code,
      message: message || messageForError(code, extra),
      correlationId,
      ...(extra.fieldErrors ? { hasFieldErrors: true } : {}),
    },
    { status: status || statusForError(code) }
  );
}

export async function POST(request) {
  const correlationId = randomUUID();
  const store = getIdempotencyStore();

  if (!isSameOrigin(request)) {
    return fail('forbidden_origin', { correlationId, status: 403 });
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return fail(JIRA_ERRORS.PAYLOAD_TOO_LARGE, { correlationId });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return fail(JIRA_ERRORS.PAYLOAD_TOO_LARGE, { correlationId });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail('validation', { correlationId });
  }

  // Honeypot: bots fill hidden fields. Accept silently, create nothing.
  // Kept alongside Turnstile as defence in depth — it costs nothing and catches
  // the naive case before we spend a siteverify call on it.
  if (body.company) {
    return NextResponse.json({ ok: true, requestKey: null, correlationId });
  }

  const schema = body.source === 'wizard' ? requestSchema : simpleSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'validation',
        message: messageForError('validation'),
        correlationId,
        // Field paths only — never the submitted values.
        fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      },
      { status: 400 }
    );
  }
  const submission = parsed.data;

  // This form is for United Mortgage personnel. The HTML email field proves
  // nothing on a public page, so the domain gate is enforced here.
  if (!isAllowedSubmitterEmail(submission.email)) {
    logRejection({
      route: ROUTES.SUBMIT,
      stage: STAGES.EMAIL_DOMAIN_VALIDATION,
      category: 'email_domain_not_allowed',
      status: 403,
      correlationId,
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'email_domain_not_allowed',
        message:
          'Please submit with your United Mortgage work email address. If you believe this is a mistake, email marketing@unitedmortgage.com.',
        correlationId,
        fields: ['email'],
      },
      { status: 403 }
    );
  }

  // Idempotency: the client sends one id per form instance, so a double click,
  // a retry, or a refresh-resubmit returns the original ticket instead of a new one.
  const submissionId =
    typeof body.submissionId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(body.submissionId)
      ? body.submissionId
      : null;

  const cached = store.get(submissionId);
  if (cached) {
    return NextResponse.json({ ...cached, duplicate: true }, { status: 200 });
  }
  if (!store.claim(submissionId)) {
    return NextResponse.json(
      { ok: false, error: 'in_progress', message: 'Your request is still being submitted…', correlationId },
      { status: 409 }
    );
  }

  try {
    const ip = clientIp(request);

    const limit = checkRateLimit(`jira:${ip}`, RATE_LIMIT);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'rate_limited', message: messageForError('rate_limited'), correlationId },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    // Bot check. Runs before Jira and before any R2 read, and the token is
    // redeemed server-side — the widget in the browser is only a hint.
    const turnstile = await verifyTurnstileToken(body.turnstileToken, {
      remoteIp: ip,
      idempotencyKey: submissionId || correlationId,
    });
    if (!turnstile.ok) {
      // The result code is safe to log; the token itself never is.
      logRejection({
        route: ROUTES.SUBMIT,
        stage: STAGES.TURNSTILE_VALIDATION,
        category: turnstile.result,
        status:
          turnstile.result === TURNSTILE_RESULTS.UNAVAILABLE ||
          turnstile.result === TURNSTILE_RESULTS.TIMEOUT
            ? 503
            : 400,
        correlationId,
      });
      return NextResponse.json(
        {
          ok: false,
          error: turnstile.result,
          message: TURNSTILE_MESSAGES[turnstile.result] || TURNSTILE_GENERIC,
          correlationId,
          // Tells the client to mint a fresh token before retrying.
          resetChallenge: true,
        },
        {
        // A timeout and an unreachable siteverify are both OUR problem, not the
        // caller's input: answer 503 so a monitor sees a dependency failure and
        // the browser does not report it as a validation error.
        status:
          turnstile.result === TURNSTILE_RESULTS.UNAVAILABLE ||
          turnstile.result === TURNSTILE_RESULTS.TIMEOUT
            ? 503
            : 400,
      }
      );
    }

    const config = getJiraConfig();
    if (!isJiraConfigured(config)) {
      logFailure({
        route: ROUTES.SUBMIT,
        stage: STAGES.JIRA_CONFIGURATION,
        category: JIRA_ERRORS.NOT_CONFIGURED,
        status: statusForError(JIRA_ERRORS.NOT_CONFIGURED),
        correlationId,
        missingEnv: missingJiraConfig(config),
      });
      return fail(JIRA_ERRORS.NOT_CONFIGURED, { correlationId });
    }

    const result = await submitJiraRequest(submission, {
      correlationId,
      submittedFrom: new URL(request.url).host,
    });

    if (!result.ok) {
      // Optional, explicitly configured, disclosed fallback. Off by default so a
      // Jira outage can never silently reroute requests to the old destination.
      if (config.emailFallbackEnabled) {
        const delivery = await deliverSubmission(submission);
        if (delivery.delivered) {
          logRejection({
          route: ROUTES.SUBMIT,
          stage: STAGES.JIRA_REQUEST_CREATION,
          category: result.error,
          status: 200,
          upstreamStatus: result.status,
          correlationId,
          outcome: 'email_fallback',
        });
          const payload = {
            ok: true,
            requestKey: null,
            requestUrl: null,
            portalUrl: config.portalUrl,
            correlationId,
            fallback: 'email',
          };
          store.remember(submissionId, payload);
          return NextResponse.json(payload, { status: 200 });
        }
      }
      return fail(result.error, {
        correlationId,
        status: result.status === 429 ? 502 : undefined,
        attachmentError: result.attachmentError,
        fileName: result.fileName,
        fieldErrors: result.fieldErrors,
      });
    }

    // Courtesy acknowledgment to the submitter — best effort, never blocks or
    // invalidates a created ticket.
    if (config.ackEmailEnabled && submission.email) {
      try {
        await sendAcknowledgment({ ...submission, requestKey: result.issueKey });
      } catch (err) {
        logFailure({
          route: ROUTES.SUBMIT,
          stage: STAGES.ACKNOWLEDGMENT_EMAIL,
          category: 'ack_email_failed',
          status: 201,
          correlationId,
          reason: err?.message,
        });
      }
    }

    const payload = {
      ok: true,
      requestKey: result.issueKey,
      requestUrl: result.webUrl,
      portalUrl: result.portalUrl,
      correlationId,
      attachments: result.attachments,
    };
    store.remember(submissionId, payload);
    return NextResponse.json(payload, { status: 201 });
  } catch (err) {
    logFailure({
      route: ROUTES.SUBMIT,
      stage: STAGES.UNHANDLED,
      category: JIRA_ERRORS.UNAVAILABLE,
      status: statusForError(JIRA_ERRORS.UNAVAILABLE),
      correlationId,
      reason: err?.message,
    });
    return fail(JIRA_ERRORS.UNAVAILABLE, { correlationId });
  } finally {
    store.release(submissionId);
  }
}
