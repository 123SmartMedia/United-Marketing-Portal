/**
 * Validation for admin edits to a post (PATCH /api/admin/posts?id=).
 * Pure and dependency-free so it is unit-testable; the caller supplies the
 * category check. Unknown fields are REJECTED rather than ignored, so a typo
 * in the admin UI surfaces as an error instead of a silent no-op.
 */

/**
 * Display order, shared by public pages and the admin list: pieces an admin has
 * positioned come first (lowest position first), then everything else newest first.
 */
export function sortForDisplay(list) {
  const hasPos = (p) => Number.isFinite(p?.position);
  return [...list].sort((a, b) => {
    if (hasPos(a) && hasPos(b) && a.position !== b.position) return a.position - b.position;
    if (hasPos(a) !== hasPos(b)) return hasPos(a) ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

export const POST_LIMITS = Object.freeze({ title: 200, caption: 3000, group: 40, hashtag: 60, hashtags: 40 });

const PATCHABLE = new Set(['title', 'category', 'group', 'caption', 'hashtags', 'published']);

export function clip(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeHashtags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((h) => clip(h, POST_LIMITS.hashtag).replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, POST_LIMITS.hashtags);
}

/** Returns { ok: true, patch } or { ok: false, error, field }. */
export function normalizePostPatch(body, { isValidCategory }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const unknown = Object.keys(body).find((key) => !PATCHABLE.has(key));
  if (unknown) return { ok: false, error: 'unknown_field', field: unknown };

  const patch = {};
  if ('title' in body) {
    patch.title = clip(body.title, POST_LIMITS.title);
    if (!patch.title) return { ok: false, error: 'missing_title', field: 'title' };
  }
  if ('category' in body) {
    patch.category = clip(body.category, 80);
    if (!isValidCategory(patch.category)) return { ok: false, error: 'invalid_category', field: 'category' };
  }
  if ('group' in body) patch.group = clip(body.group, POST_LIMITS.group) || null;
  if ('caption' in body) patch.caption = clip(body.caption, POST_LIMITS.caption);
  if ('hashtags' in body) {
    if (!Array.isArray(body.hashtags)) return { ok: false, error: 'invalid_hashtags', field: 'hashtags' };
    patch.hashtags = normalizeHashtags(body.hashtags);
  }
  if ('published' in body) {
    if (typeof body.published !== 'boolean') return { ok: false, error: 'invalid_published', field: 'published' };
    patch.published = body.published;
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'empty_patch' };
  return { ok: true, patch };
}

/** Returns { ok: true, category, ids } or { ok: false, error }. */
export function normalizeReorder(body, { isValidCategory }) {
  const category = clip(body?.category, 80);
  if (!isValidCategory(category)) return { ok: false, error: 'invalid_category' };
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((id) => typeof id === 'string' && id.length <= 64)) {
    return { ok: false, error: 'invalid_order' };
  }
  return { ok: true, category, ids };
}
