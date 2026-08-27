'use client';

import { useState } from 'react';

export default function LoginForm() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setStatus('submitting');
    setError('');
    const password = new FormData(e.currentTarget).get('password');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        window.location.reload();
      } else {
        setStatus('idle');
        setError(json.error === 'invalid_password' ? 'Incorrect password.' : 'Sign-in failed.');
      }
    } catch {
      setStatus('idle');
      setError('Something went wrong. Please try again.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-navy-800">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        className="h-12 w-full rounded-xl border border-navy-200 px-4 text-[15px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
      />
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="mt-4 w-full rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
      >
        {status === 'submitting' ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
