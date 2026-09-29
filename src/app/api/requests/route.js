import { NextResponse } from 'next/server';
import { deliverSubmission } from '@/lib/submissions';
import { simpleSchema } from '@/lib/requestSchema';
import { parseDomainList } from '@/lib/jira/config';
import { verifyTurnstileToken, TURNSTILE_RESULTS } from '@/lib/turnstile';
import { checkRateLimit, clientIp, isSameOrigin } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inline request forms (Get Started, category pages) -> marketing desk email.
 *
 * This endpoint sends mail from marketing@unitedmortgage.com — including an
 * acknowledgment to the submitted address — so it is gated like the Jira path:
 * same-origin, size cap, honeypot, per-IP throttle, schema, a submitter
 * allow-list that is CLOSED by default, and Turnstile last (the only outbound
 * call). Without these it would be an open relay for phishing from our domain.
 *
 * The multi-step wizard does not post here (it uses /api/jira/requests/*), so
 * only the lenient inline-form schema is accepted.
 */

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };
const DEFAULT_DOMAINS = ['unitedmortgage.com'];

/** Closed by default: unset means United Mortgage only, never "anyone". */
function isAllowedInlineFormEmail(email, env = process.env) {
  if (typeof email !== 'string') return false;
  const configured = parseDomainList(env.ALLOWED_REQUEST_EMAIL_DOMAINS);
  const allowed = configured.length ? configured : DEFAULT_DOMAINS;
  const domain = email.trim().split('@')[1]?.toLowerCase();
  return Boolean(domain) && allowed.includes(domain);
}

const fail = (status, error, message, extra = {}, headers) =>
  NextResponse.json({ ok: false, error, message, ...extra }, { status, headers });

const TOO_LONG = 'Your request is too long. Please shorten the details.';

export async function POST(request) {
  if (!isSameOrigin(request)) {
    return fail(403, 'forbidden_origin', 'This form can only be submitted from the marketing site.');
  }

  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return fail(413, 'payload_too_large', TOO_LONG);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'payload_too_large', TOO_LONG);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'invalid_json', 'Please check the form and try again.');
  }

  // Honeypot: bots fill hidden fields. Silently accept, don't deliver.
  if (body?.company) return NextResponse.json({ ok: true });

  const ip = clientIp(request);
  const limit = checkRateLimit(`requests:${ip}`, RATE_LIMIT);
  if (!limit.allowed) {
    return fail(
      429,
      'rate_limited',
      'Too many requests. Please wait a few minutes and try again.',
      {},
      { 'Retry-After': String(limit.retryAfterSeconds) }
    );
  }

  const parsed = simpleSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'validation', 'Please fill in the required fields.', {
      issues: parsed.error.issues.map((i) => i.path.join('.')),
    });
  }

  if (!isAllowedInlineFormEmail(parsed.data.email)) {
    return fail(403, 'email_domain_not_allowed', 'Please use your United Mortgage work email address.', {
      fields: ['email'],
    });
  }

  const turnstile = await verifyTurnstileToken(body.turnstileToken, { remoteIp: ip });
  if (!turnstile.ok) {
    const outage =
      turnstile.result === TURNSTILE_RESULTS.UNAVAILABLE || turnstile.result === TURNSTILE_RESULTS.TIMEOUT;
    return fail(
      outage ? 503 : 400,
      turnstile.result,
      outage
        ? 'We couldn’t reach the verification service. Please try again in a moment.'
        : 'Please complete the “Verify you’re human” check and try again.',
      { resetChallenge: true }
    );
  }

  const result = await deliverSubmission(parsed.data);
  if (!result.delivered) {
    return fail(502, 'delivery_failed', 'We couldn’t send your request. Please email marketing@unitedmortgage.com.', {
      resetChallenge: true,
    });
  }
  return NextResponse.json({ ok: true });
}
