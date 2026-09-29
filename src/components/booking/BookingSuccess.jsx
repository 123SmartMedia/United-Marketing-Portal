'use client';

import { useEffect, useRef } from 'react';
import { buildIcs } from '@/lib/booking/ics';
import { ROOM, formatDate, formatTime, formatDuration } from '@/lib/booking/rules';

export default function BookingSuccess({ booking, confirmationSent, onBookAnother }) {
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function downloadInvite() {
    const blob = new Blob([buildIcs(booking)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'podcast-room.ics';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
      <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-navy-900 focus:outline-none">
        You’re booked!
      </h3>
      <dl className="mt-4 grid gap-2 text-sm text-navy-800 sm:grid-cols-[120px_1fr]">
        <dt className="font-semibold">Room</dt>
        <dd>{ROOM.name}</dd>
        <dt className="font-semibold">When</dt>
        <dd>
          {formatDate(booking.date)}, {formatTime(booking.start)} – {formatTime(booking.end)} ET
        </dd>
        <dt className="font-semibold">Length</dt>
        <dd>{formatDuration(booking.durationMinutes)}</dd>
        <dt className="font-semibold">Recording</dt>
        <dd>{booking.purpose}</dd>
      </dl>
      <p className="mt-4 text-sm text-navy-700">
        {confirmationSent
          ? 'A confirmation with a calendar invite and a cancel link is on its way to your inbox.'
          : 'Your booking is saved, but we couldn’t send the confirmation email. Add it to your calendar below, and email marketing@unitedmortgage.com if you need to cancel.'}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={downloadInvite}
          className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Add to calendar (.ics)
        </button>
        <button
          type="button"
          onClick={onBookAnother}
          className="rounded-full border border-navy-300 bg-white px-5 py-2.5 text-sm font-semibold text-navy-800 transition hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Book another time
        </button>
      </div>
    </div>
  );
}
