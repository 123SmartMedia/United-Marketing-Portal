/**
 * "My kit" — favorites saved on this device.
 * ------------------------------------------
 * The portal has no login, so favorites live in localStorage. Each entry keeps
 * enough (title, thumbnail) to render even before current data is resolved.
 *
 * Pure helpers first, then a tiny external store shaped for React's
 * useSyncExternalStore: stable snapshots (re-parsed only when the stored
 * string changes), cross-tab sync through the `storage` event, and every
 * storage access wrapped so private mode or blocked storage degrades to an
 * empty, non-persistent kit instead of an error.
 */

export const FAVORITES_KEY = 'umd:favorites';
export const MAX_FAVORITES = 200;

const EMPTY = Object.freeze([]);

export function favoriteKey(category, slug) {
  return `${category}/${slug}`;
}

/** Build a stored entry from a catalog item or admin post item. */
export function toEntry(item, category, now = new Date()) {
  return {
    category,
    slug: item.slug,
    title: item.title,
    thumbnail: item.thumbnail || null,
    addedAt: now.toISOString(),
  };
}

function isValidEntry(e) {
  return (
    e &&
    typeof e === 'object' &&
    typeof e.category === 'string' &&
    typeof e.slug === 'string' &&
    e.category &&
    e.slug &&
    typeof e.title === 'string'
  );
}

/** Parse the stored JSON, dropping malformed and duplicate entries. */
export function parseFavorites(raw) {
  if (!raw) return EMPTY;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(parsed)) return EMPTY;
  const seen = new Set();
  const out = [];
  for (const e of parsed) {
    if (!isValidEntry(e)) continue;
    const key = favoriteKey(e.category, e.slug);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      category: e.category,
      slug: e.slug,
      title: e.title,
      thumbnail: typeof e.thumbnail === 'string' ? e.thumbnail : null,
      addedAt: typeof e.addedAt === 'string' ? e.addedAt : '',
    });
  }
  return out.slice(0, MAX_FAVORITES);
}

export function hasFavorite(list, category, slug) {
  const key = favoriteKey(category, slug);
  return list.some((e) => favoriteKey(e.category, e.slug) === key);
}

export function removeFavorite(list, category, slug) {
  const key = favoriteKey(category, slug);
  return list.filter((e) => favoriteKey(e.category, e.slug) !== key);
}

/** Add (newest first) or remove. Returns a new array; never mutates. */
export function toggleFavorite(list, entry) {
  if (hasFavorite(list, entry.category, entry.slug)) return removeFavorite(list, entry.category, entry.slug);
  return [entry, ...list].slice(0, MAX_FAVORITES);
}

/**
 * Store over a Storage-like object. `getStorage` is a function so a blocked
 * `window.localStorage` getter (which throws) is caught on each access.
 */
export function createFavoritesStore({ getStorage, target } = {}) {
  const listeners = new Set();
  let lastRaw = null;
  let lastList = EMPTY;
  let memoryRaw = null; // fallback when storage is unavailable

  function readRaw() {
    try {
      return getStorage()?.getItem(FAVORITES_KEY) ?? null;
    } catch {
      return memoryRaw;
    }
  }

  function getSnapshot() {
    const raw = readRaw();
    if (raw !== lastRaw) {
      lastRaw = raw;
      lastList = parseFavorites(raw);
    }
    return lastList;
  }

  function emit() {
    for (const l of listeners) l();
  }

  function write(list) {
    const raw = JSON.stringify(list);
    memoryRaw = raw;
    try {
      getStorage()?.setItem(FAVORITES_KEY, raw);
    } catch {
      // Storage blocked or full — keep this tab's in-memory copy.
    }
    emit();
  }

  function onStorage(event) {
    if (!event || event.key === null || event.key === FAVORITES_KEY) emit();
  }

  return {
    getSnapshot,
    getServerSnapshot: () => EMPTY,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) target?.addEventListener?.('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) target?.removeEventListener?.('storage', onStorage);
      };
    },
    toggle(entry) {
      write(toggleFavorite(getSnapshot(), entry));
    },
    remove(category, slug) {
      write(removeFavorite(getSnapshot(), category, slug));
    },
    clear() {
      write([]);
    },
  };
}
