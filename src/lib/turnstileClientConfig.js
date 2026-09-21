/**
 * The Turnstile configuration a Server Component hands to the browser.
 * --------------------------------------------------------------------
 * Read at REQUEST time by a dynamically rendered Server Component, then passed
 * to the client as ordinary props.
 *
 * ## Why not NEXT_PUBLIC_TURNSTILE_SITE_KEY
 *
 * Next.js replaces every `process.env.NEXT_PUBLIC_*` reference with a literal
 * during `next build` — in server code as well as client code. The value is
 * frozen into the bundle, so `export const dynamic = 'force-dynamic'` does not
 * make it re-readable: a dynamically rendered page would still serve whatever
 * string was present at build time.
 *
 * That is exactly how production ended up serving an empty site key: the page
 * was prerendered before the key existed, and adding it in Vercel afterwards
 * changed nothing without a rebuild.
 *
 * `TURNSTILE_SITE_KEY` carries no `NEXT_PUBLIC_` prefix, so Next leaves it as a
 * real `process.env` lookup. A dynamic Server Component therefore reads the
 * live value on every request, and rotating the key takes effect immediately —
 * no rebuild, no redeploy.
 *
 * ## What is and is not secret
 *
 * `TURNSTILE_SITE_KEY` is **public**. It identifies the widget and is visible in
 * the page source by design; the absent prefix is about *when* it is read, not
 * about hiding it.
 *
 * `TURNSTILE_SECRET_KEY` is **server-only** and is never referenced here, never
 * passed as a prop, and never reaches a client component. It is read solely by
 * `src/lib/turnstile.js` when redeeming a token against Cloudflare's siteverify
 * endpoint. This module deliberately has no access to it.
 */

/** The env var holding the public widget key. Not prefixed, so it stays runtime. */
export const SITE_KEY_ENV_VAR = 'TURNSTILE_SITE_KEY';

/** Default action name, matched by the server during siteverify. */
export const DEFAULT_ACTION = 'marketing_request';

// Env values pasted into a dashboard can pick up stray whitespace or an
// accidental duplicate line. Take the first non-empty line, trimmed.
const cleanEnv = (value) =>
  (value || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';

/**
 * Build the props a dynamically rendered Server Component passes to the wizard.
 *
 * @param {object} env  defaults to process.env; injectable so this is testable
 *                      without mutating the real environment
 * @returns {{ siteKey: string, action: string, configured: boolean }}
 */
export function getTurnstileClientConfig(env = process.env) {
  const siteKey = cleanEnv(env[SITE_KEY_ENV_VAR]);

  return {
    siteKey,
    // TURNSTILE_ACTION is the pre-hardening name, kept as a back-compat alias.
    action:
      cleanEnv(env.TURNSTILE_EXPECTED_ACTION) || cleanEnv(env.TURNSTILE_ACTION) || DEFAULT_ACTION,
    // An empty site key is a configuration fault, not a reason to hide the
    // widget. The client renders a visible message and keeps Submit disabled.
    configured: Boolean(siteKey),
  };
}
