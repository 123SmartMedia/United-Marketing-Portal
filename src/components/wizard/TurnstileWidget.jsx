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
 * ## It never renders nothing
 *
 * This component previously returned `null` when `siteKey` was empty. Combined
 * with a submit button that only waited for a token *when a site key existed*,
 * a missing `TURNSTILE_SITE_KEY` produced a page with no visible
 * challenge and an enabled Submit button — which then failed server-side with
 * "Please complete the Verify you're human challenge". The failure was invisible
 * until the user had filled in the whole form.
 *
 * So: a missing site key now renders a visible, explicit error, and reports
 * `unavailable` to the parent so Submit is disabled. A misconfiguration is loud.
 *
 * ## Unmounting invalidates the token
 *
 * `turnstile.remove()` destroys the challenge, so any token it produced stops
 * being redeemable. The wizard unmounts this component when the user navigates
 * back a step, so the cleanup path clears the parent's token too — otherwise a
 * user who solved the challenge, went back, and returned would hold a stale
 * token that looks valid to the button and is rejected by Cloudflare.
 *
 * Accessibility: the widget is labelled, its status is announced politely, and
 * errors are associated with it via aria-describedby.
 */

const SCRIPT_ID = 'cf-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const TURNSTILE_UNAVAILABLE_MESSAGE =
  'Verification is temporarily unavailable. Please contact the marketing desk.';

const SCRIPT_BLOCKED_MESSAGE =
  'The verification challenge couldn’t load. Check your connection or disable content blocking, then try again.';

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

export default function TurnstileWidget({
  siteKey,
  action,
  onToken,
  onExpire,
  onUnavailable,
  resetSignal = 0,
  error,
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const callbacksRef = useRef({ onToken, onExpire, onUnavailable });
  const [scriptError, setScriptError] = useState(false);
  const labelId = useId();
  const errorId = useId();

  const configured = Boolean(siteKey);

  // Keep the latest callbacks reachable without re-rendering the widget.
  callbacksRef.current = { onToken, onExpire, onUnavailable };

  const handleToken = useCallback((token) => callbacksRef.current.onToken?.(token), []);
  const handleExpire = useCallback(() => callbacksRef.current.onExpire?.(), []);

  // Tell the parent the challenge cannot be completed, so Submit stays disabled
  // rather than letting the user fill in a form that will be rejected.
  useEffect(() => {
    if (!configured) callbacksRef.current.onUnavailable?.('missing_site_key');
    else if (scriptError) callbacksRef.current.onUnavailable?.('script_blocked');
  }, [configured, scriptError]);

  useEffect(() => {
    if (!configured) return undefined;
    let cancelled = false;

    loadTurnstileScript()
      .then((turnstile) => {
        // The ref guard also covers React Strict Mode's double effect invocation
        // in development, which would otherwise render two widgets.
        if (cancelled || !containerRef.current || widgetIdRef.current !== null) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: action || undefined,
          callback: handleToken,
          'expired-callback': handleExpire,
          'timeout-callback': handleExpire,
          'error-callback': handleExpire,
          theme: 'light',
          // Managed widget, always shown. Never 'invisible' or 'interaction-only':
          // the user must be able to see that a challenge exists.
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
        // Removing the widget invalidates whatever token it minted, so the
        // parent must not keep holding one. Back-navigation lands here.
        callbacksRef.current.onExpire?.();
      }
    };
  }, [configured, siteKey, action, handleToken, handleExpire]);

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

  // A missing site key is a configuration fault, not a reason to render nothing.
  if (!configured) {
    return (
      <div data-testid="turnstile-unavailable">
        <span className="mb-1.5 block text-sm font-medium text-navy-800">
          Verify you’re human <span className="text-brand-500">*</span>
        </span>
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {TURNSTILE_UNAVAILABLE_MESSAGE}
        </p>
      </div>
    );
  }

  const shownError = scriptError ? SCRIPT_BLOCKED_MESSAGE : error;

  return (
    <div data-testid="turnstile-widget">
      <span id={labelId} className="mb-1.5 block text-sm font-medium text-navy-800">
        Verify you’re human <span className="text-brand-500">*</span>
      </span>
      <div
        ref={containerRef}
        data-testid="turnstile-container"
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
