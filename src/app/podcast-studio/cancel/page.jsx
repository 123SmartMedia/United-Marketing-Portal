import Link from 'next/link';

import CancelBooking from '@/components/booking/CancelBooking';
import { getBookingSecret, verifyCancelToken } from '@/lib/booking/token';
import { findBooking, getBookingStoreConfig } from '@/lib/booking/store';
import { ROOM, formatDate, formatTime } from '@/lib/booking/rules';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cancel podcast room booking',
  robots: { index: false, follow: false },
};

/**
 * Landing page for the emailed cancel link. It only SHOWS the booking; the
 * cancellation itself is a button-triggered POST, so a mail scanner that
 * pre-fetches the link cannot cancel anything.
 */
async function loadBooking({ id, date, t }) {
  const secret = getBookingSecret();
  if (!id || !date || !t || !verifyCancelToken({ id, date, token: t }, secret)) return { state: 'invalid' };
  if (!getBookingStoreConfig().configured) return { state: 'unavailable' };
  try {
    const booking = await findBooking(id, date);
    if (!booking) return { state: 'invalid' };
    if (booking.status === 'cancelled') return { state: 'cancelled', booking };
    return { state: 'active', booking };
  } catch {
    return { state: 'unavailable' };
  }
}

export default async function CancelPage({ searchParams }) {
  const params = await searchParams;
  const pick = (v) => (typeof v === 'string' ? v : '');
  const token = { id: pick(params.id), date: pick(params.date), t: pick(params.t) };
  const { state, booking } = await loadBooking(token);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold text-navy-900 sm:text-3xl">Cancel your booking</h1>

      {booking && (
        <div className="mt-6 rounded-2xl border border-navy-100 bg-white p-5 text-sm text-navy-800 shadow-sm">
          <p className="font-semibold text-navy-900">{ROOM.name}</p>
          <p className="mt-1">
            {formatDate(booking.date)}, {formatTime(booking.start)} – {formatTime(booking.end)} ET
          </p>
          <p className="mt-1 text-navy-600">{booking.purpose}</p>
        </div>
      )}

      <div className="mt-6">
        {state === 'active' && <CancelBooking id={token.id} date={token.date} token={token.t} />}
        {state === 'cancelled' && <p className="text-navy-700">This booking has already been cancelled.</p>}
        {state === 'invalid' && (
          <p className="text-navy-700">
            This cancel link isn’t valid. Please use the link from your confirmation email, or email{' '}
            <a href="mailto:marketing@unitedmortgage.com" className="font-semibold text-brand-600 underline">
              marketing@unitedmortgage.com
            </a>
            .
          </p>
        )}
        {state === 'unavailable' && (
          <p className="text-navy-700">We couldn’t load your booking right now. Please try again in a few minutes.</p>
        )}
      </div>

      <Link href="/podcast-studio" className="mt-10 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
        ← Back to the podcast room calendar
      </Link>
    </div>
  );
}
