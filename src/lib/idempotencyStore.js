/**
 * Server-side idempotency, behind a swappable interface.
 * ------------------------------------------------------
 * A submission id travels with each request. The store remembers the outcome so
 * a double click, a retry, or a refresh-resubmit returns the original ticket
 * instead of opening a second one, and marks an id in-flight so two
 * near-simultaneous requests cannot both reach Jira.
 *
 * ## Interface
 *
 *   get(key)            -> stored result | null
 *   remember(key, value, { ttlMs })
 *   claim(key)          -> true if this caller now owns the in-flight slot
 *   release(key)
 *
 * ## Production note — this store is NOT durable
 *
 * The bundled implementation is per-process, so on Vercel each lambda instance
 * has its own copy. Two clicks routed to different instances can still produce
 * two tickets. The client-side in-flight guard in RequestWizard makes that
 * unlikely, but it is not a guarantee.
 *
 * The repository has no Redis, KV or database dependency today, and none was
 * added here (a durable store is a paid-service decision). To close the gap,
 * implement this same four-method shape against Vercel KV / Upstash Redis and
 * return it from `createIdempotencyStore()` when its env vars are present.
 * Nothing else needs to change. See docs/jira-integration.md §"Duplicate
 * protection".
 */

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TRACKED_KEYS = 5000;

/** In-process implementation of the idempotency interface. */
export function createMemoryIdempotencyStore() {
  const results = new Map(); // key -> { expiresAt, value }
  const inFlight = new Set();

  function prune(now) {
    if (results.size < MAX_TRACKED_KEYS) return;
    for (const [key, entry] of results) {
      if (entry.expiresAt < now) results.delete(key);
    }
  }

  return {
    durable: false,
    name: 'memory',

    get(key) {
      if (!key) return null;
      const entry = results.get(key);
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        results.delete(key);
        return null;
      }
      return entry.value;
    },

    remember(key, value, { ttlMs = DEFAULT_TTL_MS } = {}) {
      if (!key) return;
      const now = Date.now();
      prune(now);
      results.set(key, { expiresAt: now + ttlMs, value });
    },

    claim(key) {
      if (!key) return true;
      if (inFlight.has(key)) return false;
      inFlight.add(key);
      return true;
    },

    release(key) {
      if (key) inFlight.delete(key);
    },

    /** Test-only. */
    reset() {
      results.clear();
      inFlight.clear();
    },
  };
}

let store = null;

/**
 * The process-wide store. A durable adapter would be selected here, based on its
 * own env vars, before falling back to memory.
 */
export function getIdempotencyStore() {
  if (!store) store = createMemoryIdempotencyStore();
  return store;
}

/** Test-only: clear state between cases. */
export function __resetIdempotencyStore() {
  getIdempotencyStore().reset();
}
