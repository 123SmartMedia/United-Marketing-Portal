'use client';

import { useEffect, useState } from 'react';
import { formatDate, formatTime, formatDuration } from '@/lib/booking/rules';

/** Upcoming podcast room bookings, with who booked each one and a cancel action. */
export default function BookingsPanel() {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    fetch('/api/admin/bookings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error);
        setBookings(json.bookings);
      })
      .catch((err) => {
        setBookings([]);
        setError(err.message === 'not_configured' ? 'Room booking storage isn’t configured.' : 'Couldn’t load bookings. Refresh to try again.');
      });
  }, []);

  async function cancel(b) {
    if (!confirm(`Cancel ${b.name}’s booking on ${formatDate(b.date, { weekday: 'short', month: 'short' })} at ${formatTime(b.start)}? They’ll get an email.`)) return;
    setBusyId(b.id);
    setError('');
    const res = await fetch(`/api/admin/bookings?id=${encodeURIComponent(b.id)}&date=${encodeURIComponent(b.date)}`, { method: 'DELETE' });
    setBusyId('');
    if (res.ok) setBookings((list) => list.filter((x) => x.id !== b.id));
    else setError('Couldn’t cancel that booking. Please try again.');
  }

  return (
    <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8" aria-labelledby="bookings-heading">
      <div className="border-t border-navy-100 pt-10">
        <h2 id="bookings-heading" className="text-xl font-bold text-navy-900">Podcast room bookings</h2>
        <p className="mt-1 text-sm text-navy-500">Upcoming reservations. Cancelling emails the person who booked.</p>

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {bookings === null ? (
          <p className="mt-6 text-sm text-navy-500">Loading…</p>
        ) : bookings.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-500">No upcoming bookings.</p>
        ) : (
          <ul className="mt-6 divide-y divide-navy-100 rounded-2xl border border-navy-100 bg-white">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="sm:w-56">
                  <p className="text-sm font-semibold text-navy-900">{formatDate(b.date, { weekday: 'short', month: 'short' })}</p>
                  <p className="text-sm text-navy-600">
                    {formatTime(b.start)} – {formatTime(b.end)} · {formatDuration(b.durationMinutes)}
                  </p>
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-navy-800">{b.purpose}</p>
                  <p className="truncate text-navy-600">
                    {b.name} · <a href={`mailto:${b.email}`} className="text-brand-600 hover:underline">{b.email}</a> · {b.attendees}{' '}
                    {b.attendees === 1 ? 'person' : 'people'}
                  </p>
                  {b.notes && <p className="mt-1 text-navy-500">{b.notes}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => cancel(b)}
                  disabled={busyId === b.id}
                  aria-label={`Cancel ${b.name}’s booking on ${formatDate(b.date)} at ${formatTime(b.start)}`}
                  className="self-start rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 sm:self-center"
                >
                  {busyId === b.id ? 'Cancelling…' : 'Cancel'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
