/**
 * Catalog search — pure, shared by the search overlay and its tests.
 * ----------------------------------------------------------------
 * Every query term must match (AND). A term matches when it, or one of its
 * synonyms, appears anywhere in the item's haystack: title, category, group,
 * file labels / types / extensions, language, brand, caption and hashtags.
 * Title hits rank above everything else.
 */

/** Words people type → words the catalog actually contains. */
export const SYNONYMS = Object.freeze({
  spanish: ['spanish', 'espanol', 'español'],
  espanol: ['spanish'],
  español: ['spanish'],
  english: ['english'],
  video: ['video', 'mp4', 'reel'],
  videos: ['video', 'mp4', 'reel'],
  reel: ['video', 'reel'],
  flyer: ['flyer', 'flyers', 'pdf'],
  flyers: ['flyer', 'flyers', 'pdf'],
  image: ['image', 'png', 'jpg', 'jpeg'],
  photo: ['image', 'png', 'jpg', 'jpeg'],
  pdf: ['pdf'],
  cobrand: ['cobranded', 'cobrand', 'co-brand'],
  cobranded: ['cobranded', 'cobrand'],
  'co-branded': ['cobranded', 'cobrand'],
  social: ['social', 'post', 'posts'],
  post: ['post', 'posts', 'social'],
});

const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/** Lower-cased, accent-free text describing everything about an item. */
export function buildHaystack(item) {
  const parts = [item.title, item.categoryTitle, item.category, item.group, item.caption];
  for (const tag of item.hashtags || []) parts.push(tag);
  for (const type of item.types || []) parts.push(type);
  for (const f of item.files || []) parts.push(f.label, f.name, f.type, f.ext, f.lang, f.brand, f.style);
  return normalize(parts.filter(Boolean).join(' ').replace(/[-_]/g, ' '));
}

function termVariants(term) {
  return [term, ...(SYNONYMS[term] || []).map(normalize)];
}

export function tokenize(query) {
  return normalize(query)
    .split(/\s+/)
    .map((t) => t.replace(/^#/, ''))
    .filter(Boolean);
}

/**
 * Rank `items` for `query`. Returns every match (no cap), best first.
 * Items may carry a precomputed `_haystack` to skip rebuilding it per keystroke.
 */
export function searchItems(items, query) {
  const terms = tokenize(query);
  if (!terms.length) return [];

  const scored = [];
  for (const item of items) {
    const haystack = item._haystack ?? buildHaystack(item);
    const title = normalize(item.title);
    let score = 0;
    let matched = true;
    for (const term of terms) {
      const variants = termVariants(term);
      if (!variants.some((v) => haystack.includes(v))) {
        matched = false;
        break;
      }
      if (variants.some((v) => title.includes(v))) score += 3;
      if (variants.some((v) => title.startsWith(v))) score += 2;
      score += 1;
    }
    if (matched) scored.push({ item, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .map((r) => r.item);
}

/** Attach a cached haystack to each item once, for fast repeated searches. */
export function indexItems(items) {
  return items.map((item) => ({ ...item, _haystack: buildHaystack(item) }));
}
