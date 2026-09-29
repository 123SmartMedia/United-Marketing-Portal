'use client';

import { useEffect, useState } from 'react';
import TurnstileWidget from '@/components/wizard/TurnstileWidget';

const REQUEST_TYPES = [
  'Business Cards',
  'Letterhead / Stationery',
  'Cobranded Folder',
  'Print Order (banner, sign, door hanger)',
  'Flyer Customization',
  'Custom / Other',
];

/**
 * Reusable request form. Posts to /api/requests, which emails the marketing desk
 * (and, in Phase 2, can also create a Total Expert task). `defaultType` and
 * `asset` pre-fill context when embedded on a category or item page.
 *
 * Turnstile-gated like the wizard. This form renders on static/ISR pages, so
 * the public site key is fetched from /api/turnstile-config at runtime rather
 * than passed as a server prop (which would be frozen at build time).
 */
const CONFIG_LOADING = { siteKey: null, action: '' };
export default function RequestForm({ defaultType = 'Custom / Other', asset = '', compact = false }) {
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error
  const [error, setError] = useState('');
  const [turnstile, setTurnstile] = useState(CONFIG_LOADING);
  // Single-use token: cleared and re-minted after every attempt.
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const [challengeReset, setChallengeReset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/turnstile-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((cfg) => !cancelled && setTurnstile({ siteKey: cfg.siteKey || '', action: cfg.action || '' }))
      .catch(() => !cancelled && setTurnstile({ siteKey: '', action: '' }));
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setStatus('submitting');
    setError('');
    setTurnstileError('');
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, turnstileToken }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setStatus('success');
        form.reset();
      } else {
        if (typeof json.error === 'string' && json.error.startsWith('turnstile_')) setTurnstileError(json.message);
        setStatus('error');
        setError(json.message || errorMessage(json.error));
      }
    } catch {
      setStatus('error');
      setError('Something went wrong. Please email marketing@unitedmortgage.com directly.');
    } finally {
      // A Turnstile token is single use — mint a fresh one after any attempt.
      setTurnstileToken('');
      setChallengeReset((n) => n + 1);
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white">
          ✓
        </div>
        <h3 className="text-lg font-semibold text-navy-900">Request received</h3>
        <p className="mt-2 text-sm text-navy-600">
          Thanks — the marketing desk has your request and will follow up by email.
        </p>
        <button
          onClick={() => setStatus('idle')}
          className="mt-5 text-sm font-semibold text-brand-600 hover:text-brand-700"
        >
          Submit another request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Honeypot */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <input type="hidden" name="asset" defaultValue={asset} />

      <Field label="Request type">
        <select
          name="requestType"
          defaultValue={defaultType}
          className="w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
        >
          {REQUEST_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>

      <div className={compact ? 'space-y-4' : 'grid gap-4 sm:grid-cols-2'}>
        <Field label="Full name" required>
          <TextInput name="name" required placeholder="Jane Officer" />
        </Field>
        <Field label="Work email" required>
          <TextInput name="email" type="email" required placeholder="jofficer@unitedmortgage.com" />
        </Field>
        <Field label="Phone">
          <TextInput name="phone" placeholder="516-555-0100" />
        </Field>
        <Field label="NMLS ID">
          <TextInput name="nmls" placeholder="1234567" />
        </Field>
      </div>

      {asset && (
        <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-500">
          Regarding: <span className="font-semibold text-navy-700">{asset}</span>
        </p>
      )}

      <Field label="Details" required>
        <textarea
          name="details"
          required
          rows={compact ? 3 : 4}
          placeholder="Tell us what you need — quantities, cobranding info, deadlines, etc."
          className="w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
        />
      </Field>

      {turnstile.siteKey === null ? (
        <p className="text-xs text-navy-500">Loading verification…</p>
      ) : (
        <TurnstileWidget
          siteKey={turnstile.siteKey}
          action={turnstile.action}
          resetSignal={challengeReset}
          error={turnstileError}
          onToken={setTurnstileToken}
          onExpire={() => setTurnstileToken('')}
          onUnavailable={() => setTurnstileToken('')}
        />
      )}

      {status === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting' || !turnstileToken}
        className="w-full rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
      >
        {status === 'submitting' ? 'Sending…' : !turnstileToken ? 'Complete verification to submit' : 'Submit request'}
      </button>
      <p className="text-center text-xs text-navy-400">
        Goes straight to marketing@unitedmortgage.com
      </p>
    </form>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-navy-700">
        {label} {required && <span className="text-brand-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
    />
  );
}

function errorMessage(code) {
  switch (code) {
    case 'missing_required':
      return 'Please fill in your name and email.';
    case 'invalid_email':
      return 'Please enter a valid email address.';
    case 'email_domain_not_allowed':
      return 'Please use your United Mortgage work email address.';
    case 'delivery_failed':
      return 'We couldn’t send your request. Please email marketing@unitedmortgage.com.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
