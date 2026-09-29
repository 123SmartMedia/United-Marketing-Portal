'use client';

import { useState } from 'react';

export default function CancelBooking({ id, date, token }) {
  const [status, setStatus] = useState('idle'); // idle | working | done | error
  const [message, setMessage] = useState('');

  async function cancel() {
    setStatus('working');
    try {
      const res = await fetch('/api/podcast-room/bookings/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, date, token }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setStatus('done');
        return;
      }
      setMessage(json.message || 'We couldn’t cancel the booking. Please try again.');
      setStatus('error');
    } catch {
      setMessage('We couldn’t reach the server. Check your connection and try again.');
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-medium text-emerald-800">
        Your booking is cancelled. We’ve emailed you a confirmation to remove it from your calendar.
      </p>
    );
  }

  return (
    <div>
      {status === 'error' && (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <button
        type="button"
        onClick={cancel}
        disabled={status === 'working'}
        className="rounded-full bg-red-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-60"
      >
        {status === 'working' ? 'Cancelling…' : 'Yes, cancel this booking'}
      </button>
    </div>
  );
}
