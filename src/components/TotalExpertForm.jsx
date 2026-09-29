'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  totalExpertSchema,
  TE_ROLES,
  TE_ACCOUNT_TYPES,
  TE_REMEMBERED_FIELDS,
} from '@/lib/totalExpertSchema';
import { TextField, SelectField, TextareaField } from '@/components/wizard/fields';
import TurnstileWidget from '@/components/wizard/TurnstileWidget';

/**
 * Total Expert account sign-up. Posts to /api/total-expert, which opens a Jira
 * ticket for the marketing desk (or emails them when Jira can't take it).
 *
 * Turnstile handling mirrors RequestWizard: the token is single use, so it is
 * cleared and the widget reset after every attempt, and Submit stays disabled
 * while the challenge is pending or unavailable.
 */

const STORAGE_KEY = 'umd:te-signup:contact';

const EMPTY = {
  name: '', email: '', phone: '', nmls: '', branch: '',
  role: '', manager: '', accountType: '', startDate: '',
  licensedStates: '', notes: '', company: '',
};

const newSubmissionId = () =>
  globalThis.crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function loadRemembered() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return Object.fromEntries(
      TE_REMEMBERED_FIELDS.filter((k) => typeof saved[k] === 'string').map((k) => [k, saved[k]])
    );
  } catch {
    return {};
  }
}

function remember(values) {
  try {
    const contact = Object.fromEntries(TE_REMEMBERED_FIELDS.map((k) => [k, values[k] || '']));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(contact));
  } catch {
    // Storage blocked (private mode, policy) — prefill is a convenience only.
  }
}

export default function TotalExpertForm({ turnstileSiteKey = '', turnstileAction = '' }) {
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const [challengeReset, setChallengeReset] = useState(0);

  const submissionIdRef = useRef(null);
  const inFlightRef = useRef(false);
  const errorRef = useRef(null);
  const successRef = useRef(null);

  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm({
    resolver: zodResolver(totalExpertSchema),
    mode: 'onTouched',
    defaultValues: EMPTY,
  });

  // Prefill contact details from the last sign-up on this device.
  useEffect(() => {
    const saved = loadRemembered();
    if (Object.keys(saved).length) reset({ ...EMPTY, ...saved });
  }, [reset]);

  useEffect(() => {
    if (status === 'success') successRef.current?.focus();
    if (status === 'error') errorRef.current?.focus();
  }, [status]);

  async function onSubmit(values) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!submissionIdRef.current) submissionIdRef.current = newSubmissionId();

    setStatus('submitting');
    setSubmitError(null);
    setTurnstileError('');
    try {
      const res = await fetch('/api/total-expert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, submissionId: submissionIdRef.current, turnstileToken }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.ok && json.ok) {
        remember(values);
        setResult(json);
        setStatus('success');
        return;
      }

      // Any outcome spends the token; mint a fresh one before a retry.
      setTurnstileToken('');
      setChallengeReset((n) => n + 1);
      if (typeof json.error === 'string' && json.error.startsWith('turnstile_')) {
        setTurnstileError(json.message || 'Verification failed. Please try again.');
      }
      if (Array.isArray(json.fields)) {
        for (const field of json.fields) setError(field, { type: 'server', message: 'Please check this field.' });
      }
      setSubmitError({
        message: json.message || 'We couldn’t submit your sign-up right now. Please try again.',
        correlationId: json.correlationId || null,
      });
      setStatus('error');
    } catch {
      setTurnstileToken('');
      setChallengeReset((n) => n + 1);
      setSubmitError({
        message: 'We couldn’t reach the marketing desk. Your details are still here — check your connection and try again.',
        correlationId: null,
      });
      setStatus('error');
    } finally {
      inFlightRef.current = false;
    }
  }

  function startOver() {
    submissionIdRef.current = null;
    setResult(null);
    setSubmitError(null);
    reset({ ...EMPTY, ...loadRemembered() });
    setStatus('idle');
  }

  if (status === 'success') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center" role="status">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-xl text-white" aria-hidden="true">
          ✓
        </div>
        <h2 ref={successRef} tabIndex={-1} className="text-lg font-semibold text-navy-900 outline-none">
          Sign-up received
        </h2>
        {result?.requestKey ? (
          <p className="mt-3 text-sm text-navy-600">
            Your ticket number is{' '}
            <span className="rounded-md bg-white px-2 py-1 font-mono text-sm font-semibold text-navy-900">
              {result.requestKey}
            </span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-navy-600">Your sign-up was emailed to the marketing desk.</p>
        )}
        <p className="mx-auto mt-3 max-w-md text-sm text-navy-600">
          We’ll set up your Total Expert account and you’ll get a welcome email with your login. A
          confirmation is on its way to your inbox.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {result?.requestUrl && (
            <a
              href={result.requestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
            >
              View request<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          <button
            type="button"
            onClick={startOver}
            className="text-sm font-semibold text-brand-600 underline-offset-2 hover:text-brand-700 hover:underline"
          >
            Submit another sign-up
          </button>
        </div>
      </div>
    );
  }

  const submitting = status === 'submitting';
  const challengeUnavailable = !turnstileSiteKey;
  const challengePending = !turnstileToken;
  const field = (name) => ({ registration: register(name), error: errors[name]?.message });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" {...register('company')} />

      <fieldset disabled={submitting} className="space-y-6">
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">About you</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="te-name" label="Full name" required autoComplete="name" placeholder="Jane Officer" {...field('name')} />
            <TextField id="te-email" label="Work email" required type="email" autoComplete="email" placeholder="jofficer@unitedmortgage.com" {...field('email')} />
            <TextField id="te-phone" label="Phone number" required type="tel" autoComplete="tel" placeholder="631-203-7480" {...field('phone')} />
            <TextField id="te-nmls" label="NMLS ID" required inputMode="numeric" placeholder="1234567" {...field('nmls')} />
            <TextField id="te-branch" label="Branch / office" required placeholder="Melville, NY" {...field('branch')} />
            <SelectField id="te-role" label="Role" required options={TE_ROLES} {...field('role')} />
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">Your account</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField id="te-account" label="What do you need?" required options={TE_ACCOUNT_TYPES} {...field('accountType')} />
            <TextField id="te-manager" label="Manager’s name" required placeholder="Branch or sales manager" {...field('manager')} />
            <TextField id="te-start" label="Start date" type="date" hint="Optional — when you need access by." {...field('startDate')} />
            <TextField id="te-states" label="Licensed states" placeholder="NY, NJ, PA" hint="Optional." {...field('licensedStates')} />
          </div>
          <div className="mt-4">
            <TextareaField id="te-notes" label="Anything else?" rows={3} placeholder="Previous Total Expert email, team you’re joining, etc." {...field('notes')} />
          </div>
        </div>
      </fieldset>

      <section aria-labelledby="te-verification-heading" className="mt-8 rounded-2xl border border-navy-100 bg-navy-50/40 p-5">
        <h2 id="te-verification-heading" className="mb-3 text-sm font-semibold text-navy-900">
          Verification
        </h2>
        <TurnstileWidget
          siteKey={turnstileSiteKey}
          action={turnstileAction}
          resetSignal={challengeReset}
          error={turnstileError}
          onToken={setTurnstileToken}
          onExpire={() => setTurnstileToken('')}
          onUnavailable={() => setTurnstileToken('')}
        />
      </section>

      <div className="mt-8 flex justify-end">
        <button
          type="submit"
          disabled={submitting || challengePending || challengeUnavailable}
          aria-busy={submitting}
          aria-describedby={challengePending || challengeUnavailable ? 'te-challenge-pending' : undefined}
          className="rounded-full bg-brand-500 px-7 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Sending…' : 'Request my account'}
        </button>
      </div>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {submitting ? 'Submitting your sign-up…' : ''}
      </div>

      {(challengePending || challengeUnavailable) && (
        <p id="te-challenge-pending" className={`mt-3 text-right text-xs ${challengeUnavailable ? 'text-red-600' : 'text-navy-500'}`}>
          {challengeUnavailable
            ? 'Submission is unavailable until verification is restored.'
            : 'Complete the verification above to enable Submit.'}
        </p>
      )}

      {status === 'error' && submitError && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 outline-none">
          <p className="font-semibold">Your sign-up wasn’t submitted.</p>
          <p className="mt-1">{submitError.message}</p>
          {submitError.correlationId && (
            <p className="mt-2 text-xs text-red-600">
              Reference ID: <span className="font-mono">{submitError.correlationId}</span>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
