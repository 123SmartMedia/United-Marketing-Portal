import { NextResponse } from 'next/server';

import { bookingSchema } from '@/lib/booking/schema';
import { SLOT_ERRORS, SLOT_ERROR_MESSAGES } from '@/lib/booking/rules';
import { isAllowedBookingEmail } from '@/lib/booking/config';
import { getBookingSecret, cancelUrl } from '@/lib/booking/token';
import {
  createBooking,
  listBookings,
  toPublicSlot,
  getBookingStoreConfig,
  BookingStoreError,
} from '@/lib/booking/store';
import { sendBookingConfirmation, sendBookingDeskNotice } from '@/lib/booking/emails';
import { verifyTurnstileToken, TURNSTILE_RESULTS } from '@/lib/turnstile';
import { checkRateLimit, clientIp, isSameOrigin } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Podcast room bookings.
 *   GET  ?month=YYYY-MM  → booked time ranges for that month (when, never who)
 *   POST                 → create a booking (same-origin, throttled, Turnstile-gated,
 *                          United Mortgage emails only, conflict-safe)
 */

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };
const UNAVAILABLE =
  'Room booking isn’t available right now. Please email marketing@unitedmortgage.com to reserve the room.';

const json = (body, status = 200, headers) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function GET(request) {
  const month = new URL(request.url).searchParams.get('month') || '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return json({ ok: false, error: 'invalid_month' }, 400);
  }
  if (!getBookingStoreConfig().configured) {
    return json({ ok: false, error: 'not_configured', message: UNAVAILABLE }, 503);
  }
  try {
    const bookings = await listBookings([month]);
    return json({ ok: true, month, slots: bookings.map(toPublicSlot) });
  } catch (err) {
    console.error('[booking] list failed', { code: err?.code, detail: err?.detail });
    return json({ ok: false, error: 'unavailable', message: 'We couldn’t load the calendar. Please refresh to try again.' }, 503);
  }
}

async function parseBody(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function POST(request) {
  if (!isSameOrigin(request)) return json({ ok: false, error: 'forbidden_origin' }, 403);

  const body = await parseBody(request);
  if (!body) return json({ ok: false, error: 'validation', message: 'Please check the form and try again.' }, 400);

  // Honeypot: accept silently, book nothing.
  if (body.company) return json({ ok: true, booking: null });

  const ip = clientIp(request);
  const limit = checkRateLimit(`booking:${ip}`, RATE_LIMIT);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'rate_limited', message: 'Too many attempts. Please wait a moment and try again.' },
      429,
      { 'Retry-After': String(limit.retryAfterSeconds) }
    );
  }

  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        ok: false,
        error: 'validation',
        message: 'Please check the highlighted fields and try again.',
        fields: parsed.error.issues.map((i) => i.path.join('.')),
      },
      400
    );
  }
  const input = parsed.data;

  if (!isAllowedBookingEmail(input.email)) {
    return json(
      {
        ok: false,
        error: 'email_domain_not_allowed',
        message: 'Please book with your United Mortgage work email address.',
        fields: ['email'],
      },
      403
    );
  }

  const turnstile = await verifyTurnstileToken(body.turnstileToken, { remoteIp: ip });
  if (!turnstile.ok) {
    const dependency =
      turnstile.result === TURNSTILE_RESULTS.UNAVAILABLE || turnstile.result === TURNSTILE_RESULTS.TIMEOUT;
    return json(
      {
        ok: false,
        error: turnstile.result,
        message: dependency
          ? 'We couldn’t reach the verification service. Please try again in a moment.'
          : 'Please complete the “Verify you’re human” challenge and try again.',
        resetChallenge: true,
      },
      dependency ? 503 : 400
    );
  }

  const secret = getBookingSecret();
  if (!secret || !getBookingStoreConfig().configured) {
    console.error('[booking] not configured', { hasSecret: Boolean(secret) });
    return json({ ok: false, error: 'not_configured', message: UNAVAILABLE, resetChallenge: true }, 503);
  }

  let result;
  try {
    result = await createBooking(input);
  } catch (err) {
    const code = err instanceof BookingStoreError ? err.code : 'unknown';
    console.error('[booking] create failed', { code, detail: err?.detail });
    return json(
      { ok: false, error: 'unavailable', message: 'We couldn’t save your booking. Please try again.', resetChallenge: true },
      503
    );
  }

  if (!result.ok) {
    return json(
      {
        ok: false,
        error: result.error,
        message: SLOT_ERROR_MESSAGES[result.error] || 'That time isn’t available.',
        resetChallenge: true,
        refreshSlots: true,
      },
      result.error === SLOT_ERRORS.CONFLICT ? 409 : 400
    );
  }

  const { booking } = result;
  const origin = new URL(request.url).origin;
  const emails = await Promise.allSettled([
    sendBookingConfirmation(booking, { cancelLink: cancelUrl(origin, booking, secret) }),
    sendBookingDeskNotice(booking),
  ]);
  const confirmationSent = emails[0].status === 'fulfilled' && emails[0].value?.ok;
  if (!confirmationSent) console.error('[booking] confirmation email failed', { id: booking.id });

  return json(
    {
      ok: true,
      confirmationSent,
      booking: {
        id: booking.id,
        date: booking.date,
        start: booking.start,
        end: booking.end,
        durationMinutes: booking.durationMinutes,
        purpose: booking.purpose,
        attendees: booking.attendees,
        name: booking.name,
      },
    },
    201
  );
}
