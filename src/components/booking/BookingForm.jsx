'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { TextField, SelectField, TextareaField } from '@/components/wizard/fields';
import TurnstileWidget from '@/components/wizard/TurnstileWidget';
import { bookingSchema, MAX_ATTENDEES } from '@/lib/booking/schema';
import { formatDate, formatTime, formatDuration } from '@/lib/booking/rules';

/**
 * Who's booking and what for. The slot (date/start/length) comes from the
 * calendar; this form only collects the person and the purpose.
 */

const detailsSchema = bookingSchema.pick({ name: true, email: true, purpose: true, attendees: true, notes: true, company: true });
const ATTENDEE_OPTIONS = Array.from({ length: MAX_ATTENDEES }, (_, i) => String(i + 1));
const REMEMBER_KEY = 'umd:booker';

function remembered() {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function BookingForm({ slot, turnstileSiteKey, turnstileAction, onBooked, onConflict }) {
  const [status, setStatus] = useState('idle'); // idle | submitting | error
  const [error, setError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const [challengeReset, setChallengeReset] = useState(0);
  const errorRef = useRef(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: '', email: '', purpose: '', attendees: '1', notes: '', company: '' },
  });

  // Prefill the person's name and email from their last booking on this device.
  useEffect(() => {
    const saved = remembered();
    if (saved.name || saved.email) reset((v) => ({ ...v, name: saved.name || '', email: saved.email || '' }));
  }, [reset]);

  useEffect(() => {
    if (status === 'error') errorRef.current?.focus();
  }, [status]);

  async function onSubmit(values) {
    setStatus('submitting');
    setError('');
    setTurnstileError('');
    try {
      const res = await fetch('/api/podcast-room/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, ...slot, turnstileToken }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        try {
          localStorage.setItem(REMEMBER_KEY, JSON.stringify({ name: values.name, email: values.email }));
        } catch {
          // Storage blocked — prefill is a convenience only.
        }
        onBooked(json.booking, { confirmationSent: json.confirmationSent });
        return;
      }
      if (typeof json.error === 'string' && json.error.startsWith('turnstile_')) setTurnstileError(json.message);
      if (json.refreshSlots) onConflict?.();
      setError(json.message || 'Something went wrong. Please try again.');
      setStatus('error');
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.');
      setStatus('error');
    } finally {
      // A Turnstile token is single use: mint a fresh one after every attempt.
      setTurnstileToken('');
      setChallengeReset((n) => n + 1);
    }
  }

  const submitting = status === 'submitting';

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-navy-800">
        <span className="font-semibold">{formatDate(slot.date, { weekday: 'short', month: 'short' })}</span> ·{' '}
        {formatTime(slot.start)} – {formatTime(slot.end)} ET · {formatDuration(slot.durationMinutes)}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField id="bk-name" label="Your name" required autoComplete="name" error={errors.name?.message} registration={register('name')} />
        <TextField
          id="bk-email"
          label="Work email"
          type="email"
          required
          autoComplete="email"
          hint="Your confirmation and calendar invite go here."
          error={errors.email?.message}
          registration={register('email')}
        />
      </div>
      <TextField
        id="bk-purpose"
        label="What are you recording?"
        required
        placeholder="e.g. First-time buyer tips episode"
        error={errors.purpose?.message}
        registration={register('purpose')}
      />
      <SelectField
        id="bk-attendees"
        label="Number of people"
        required
        options={ATTENDEE_OPTIONS}
        error={errors.attendees?.message}
        registration={register('attendees')}
      />
      <TextareaField
        id="bk-notes"
        label="Anything we should know?"
        rows={3}
        placeholder="Guests, equipment needs, setup time…"
        error={errors.notes?.message}
        registration={register('notes')}
      />

      {/* Honeypot — hidden from people and assistive tech. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="bk-company">Company</label>
        <input id="bk-company" type="text" tabIndex={-1} autoComplete="off" {...register('company')} />
      </div>

      <TurnstileWidget
        siteKey={turnstileSiteKey}
        action={turnstileAction}
        resetSignal={challengeReset}
        error={turnstileError}
        onToken={setTurnstileToken}
        onExpire={() => setTurnstileToken('')}
        onUnavailable={() => setTurnstileToken('')}
      />

      {status === 'error' && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !turnstileToken}
        className="h-12 w-full rounded-full bg-brand-600 px-6 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:bg-navy-300 sm:w-auto"
      >
        {submitting ? 'Booking…' : !turnstileToken ? 'Complete verification to book' : 'Book the room'}
      </button>
      <p aria-live="polite" className="sr-only">
        {submitting ? 'Booking the room…' : ''}
      </p>
    </form>
  );
}
