import { NextResponse } from 'next/server';

import { cancelSchema } from '@/lib/booking/schema';
import { getBookingSecret, verifyCancelToken } from '@/lib/booking/token';
import { cancelBooking, BookingStoreError } from '@/lib/booking/store';
import { sendCancellationNotice, sendBookingDeskNotice } from '@/lib/booking/emails';
import { checkRateLimit, clientIp, isSameOrigin } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Self-service cancellation from the emailed link. A POST — never a GET — so
 * mail scanners and link previews that fetch URLs cannot cancel a booking.
 */

const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };

const json = (body, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  if (!isSameOrigin(request)) return json({ ok: false, error: 'forbidden_origin' }, 403);

  const limit = checkRateLimit(`booking-cancel:${clientIp(request)}`, RATE_LIMIT);
  if (!limit.allowed) {
    return json({ ok: false, error: 'rate_limited', message: 'Too many attempts. Please wait a moment.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = cancelSchema.safeParse(body);
  const secret = getBookingSecret();
  if (!parsed.success || !verifyCancelToken(parsed.data, secret)) {
    return json({ ok: false, error: 'invalid_link', message: 'This cancel link isn’t valid. Please use the link from your confirmation email.' }, 400);
  }

  let cancelled;
  try {
    cancelled = await cancelBooking(parsed.data.id, parsed.data.date);
  } catch (err) {
    const code = err instanceof BookingStoreError ? err.code : 'unknown';
    console.error('[booking] cancel failed', { code, detail: err?.detail });
    return json({ ok: false, error: 'unavailable', message: 'We couldn’t cancel right now. Please try again.' }, 503);
  }

  if (!cancelled) {
    return json({ ok: false, error: 'not_found', message: 'This booking was already cancelled.' }, 404);
  }

  await Promise.allSettled([sendCancellationNotice(cancelled), sendBookingDeskNotice(cancelled, { cancelled: true })]);
  return json({ ok: true });
}
