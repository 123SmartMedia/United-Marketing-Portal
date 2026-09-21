/**
 * Best-effort in-memory throttling for form endpoints.
 * ----------------------------------------------------
 * No dependency, no external store. On Vercel each lambda instance keeps its own
 * map, so this is a speed bump against accidental floods and casual abuse — NOT
 * the primary bot control. Cloudflare Turnstile (src/lib/turnstile.js) is that;
 * this and the honeypot are defence in depth behind it.
 *
 * Entries are pruned opportunistically, so memory stays bounded by traffic
 * within the window rather than growing for the life of the instance.
 *
 * Server-side idempotency lives in src/lib/idempotencyStore.js.
 */

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_HITS = 5;
const MAX_TRACKED_KEYS = 5000;

const hits = new Map(); // key -> number[] (timestamps)

function prune(now, windowMs) {
  if (hits.size < MAX_TRACKED_KEYS) return;
  for (const [key, timestamps] of hits) {
    if (!timestamps.some((t) => now - t < windowMs)) hits.delete(key);
  }
}

/** Record a hit for `key`. Returns { allowed, retryAfterSeconds }. */
export function checkRateLimit(key, { windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX_HITS } = {}) {
  const now = Date.now();
  prune(now, windowMs);

  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    const oldest = Math.min(...recent);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test-only: drop all state between cases. */
export function __resetRateLimitState() {
  hits.clear();
}

/**
 * Client IP from the proxy headers Vercel sets. Falls back to a constant so a
 * missing header degrades to a shared bucket rather than no limit at all.
 */
export function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Reject cross-origin posts. Our forms are same-origin; nothing else should be
 * posting to these endpoints.
 */
export function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  // Same-origin fetch from some browsers omits Origin; fall back to Referer.
  const source = origin || request.headers.get('referer');
  if (!source) return true;
  try {
    return new URL(source).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
