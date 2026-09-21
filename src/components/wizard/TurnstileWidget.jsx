'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile widget.
 *
 * Renders explicitly (rather than via auto-discovery) so the widget id is known
 * and the parent can reset it after a completed or failed submission — a
 * Turnstile token is single use, so a form that can be submitted twice must mint
 * a fresh one each time.
 *
 * The token it produces is a hint, not a decision: the server redeems it against
 * Cloudflare before doing any work. If the script cannot load, the field simply
 * has no token and the server rejects the submission with a clear message.
 *
 * Accessibility: the widget is labelled, its status is announced politely, and
 * errors are associated with it via aria-describedby.
 */

const SCRIPT_ID = 'cf-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Load the Turnstile script once per page. */
function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no_window'));
  if (window.turnstile) return Promise.resolve(window.turnstile);

  const existing = document.getElementById(SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.turnstile), { once: true });
      existing.addEventListener('error', () => reject(new Error('script_failed')), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error('script_failed'));
    document.head.appendChild(script);
  });
}

export default function TurnstileWidget({ siteKey, action, onToken, onExpire, resetSignal = 0, error }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const callbacksRef = useRef({ onToken, onExpire });
  const [scriptError, setScriptError] = useState(false);
  const labelId = useId();
  const errorId = useId();

  // Keep the latest callbacks reachable without re-rendering the widget.
  callbacksRef.current = { onToken, onExpire };

  const handleToken = useCallback((token) => callbacksRef.current.onToken?.(token), []);
  const handleExpire = useCallback(() => callbacksRef.current.onExpire?.(), []);

  useEffect(() => {
    if (!siteKey) return undefined;
    let cancelled = false;

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current || widgetIdRef.current !== null) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: action || undefined,
          callback: handleToken,
          'expired-callback': handleExpire,
          'timeout-callback': handleExpire,
          'error-callback': handleExpire,
          theme: 'light',
          appearance: 'always',
        });
      })
      .catch(() => {
        if (!cancelled) setScriptError(true);
      });

    return () => {
      cancelled = true;
      const turnstile = typeof window !== 'undefined' ? window.turnstile : null;
      if (turnstile && widgetIdRef.current !== null) {
        turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, action, handleToken, handleExpire]);

  // Parent bumps `resetSignal` after a submission completes or fails, so the
  // spent token is replaced rather than re-sent.
  useEffect(() => {
    if (!resetSignal) return;
    const turnstile = typeof window !== 'undefined' ? window.turnstile : null;
    if (turnstile && widgetIdRef.current !== null) {
      turnstile.reset(widgetIdRef.current);
      callbacksRef.current.onToken?.('');
    }
  }, [resetSignal]);

  if (!siteKey) return null;

  const shownError = scriptError
    ? 'The verification challenge couldn’t load. Check your connection or disable content blocking, then try again.'
    : error;

  return (
    <div>
      <span id={labelId} className="mb-1.5 block text-sm font-medium text-navy-800">
        Verify you’re human <span className="text-brand-500">*</span>
      </span>
      <div
        ref={containerRef}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={shownError ? errorId : undefined}
        className="min-h-[65px]"
      />
      <div aria-live="polite" className="sr-only">
        {shownError ? 'Verification failed.' : ''}
      </div>
      {shownError && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {shownError}
        </p>
      )}
    </div>
  );
}
