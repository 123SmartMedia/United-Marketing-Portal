/**
 * Catalog filtering — pure, shared by the Browse and category pages.
 * -----------------------------------------------------------------
 * Facets are derived from metadata the catalog actually carries (see
 * scripts/build-catalog.mjs): each file's `type`, `lang`, `brand` and `style`,
 * plus the item's `group` and, on Browse, its `category`. A facet is only
 * offered when it would narrow the list — an option every item has is noise.
 *
 * Selection semantics: OR within a facet, AND across facets. Option counts are
 * "faceted": each counts matches given the OTHER facets' selections, so a count
 * always equals what you'd see after clicking that option.
 *
 * URL state (`?type=pdf,video&lang=spanish&sort=newest`) makes views shareable.
 */

export const SORTS = Object.freeze({ AZ: 'az', NEWEST: 'newest' });
export const DEFAULT_SORT = SORTS.AZ;

const TYPE_LABELS = { pdf: 'PDF', image: 'Image', video: 'Video', doc: 'Word doc' };
const BRAND_LABELS = { Cobranded: 'Co-branded' };

/** URL-safe option value: "Color-Pop" -> "color-pop", "Style 02" -> "style-02". */
export function toValue(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const fileValues = (item, key) =>
  (item.files || []).map((f) => f?.[key]).filter((v) => typeof v === 'string' && v);

/**
 * Facet definitions, in display order. `labels(item, ctx)` returns the display
 * labels an item carries for that facet.
 */
export const FACETS = Object.freeze([
  {
    key: 'category',
    title: 'Category',
    labels: (item) => (item.categoryTitle ? [item.categoryTitle] : []),
  },
  {
    key: 'group',
    title: 'Topic',
    labels: (item, ctx) => {
      if (!ctx.groupTitles) return [];
      const key = item.group || 'other';
      return ctx.groupTitles[key] ? [ctx.groupTitles[key]] : [];
    },
  },
  {
    key: 'type',
    title: 'File type',
    labels: (item) => {
      const types = fileValues(item, 'type');
      const all = types.length ? types : item.types || [];
      return all.map((t) => TYPE_LABELS[t] || t.toUpperCase());
    },
  },
  { key: 'lang', title: 'Language', labels: (item) => fileValues(item, 'lang') },
  {
    key: 'brand',
    title: 'Branding',
    labels: (item) => fileValues(item, 'brand').map((b) => BRAND_LABELS[b] || b),
  },
  { key: 'style', title: 'Style', labels: (item) => fileValues(item, 'style') },
]);

export const FACET_KEYS = Object.freeze(FACETS.map((f) => f.key));

/** item -> { facetKey: Set<value> }, with a value -> label lookup. */
function indexItem(item, ctx) {
  const out = {};
  for (const facet of FACETS) {
    out[facet.key] = new Map(facet.labels(item, ctx).map((label) => [toValue(label), label]));
  }
  return out;
}

export function emptySelection() {
  return { ...Object.fromEntries(FACET_KEYS.map((k) => [k, []])), sort: DEFAULT_SORT };
}

export function isFiltering(selection) {
  return FACET_KEYS.some((k) => selection[k]?.length) || (selection.sort && selection.sort !== DEFAULT_SORT);
}

export function activeCount(selection) {
  return FACET_KEYS.reduce((n, k) => n + (selection[k]?.length || 0), 0);
}

function matches(index, selection, skipKey) {
  return FACET_KEYS.every((key) => {
    if (key === skipKey) return true;
    const wanted = selection[key];
    if (!wanted?.length) return true;
    return wanted.some((v) => index[key].has(v));
  });
}

/**
 * Facets worth showing for these items, each with faceted option counts:
 * [{ key, title, options: [{ value, label, count, selected }] }]
 */
export function deriveFacets(items, selection = emptySelection(), ctx = {}) {
  const indexed = items.map((item) => indexItem(item, ctx));
  const facets = [];

  for (const facet of FACETS) {
    const labels = new Map(); // value -> label
    const coverage = new Map(); // value -> items carrying it (unfiltered)
    indexed.forEach((index) => {
      for (const [value, label] of index[facet.key]) {
        labels.set(value, label);
        coverage.set(value, (coverage.get(value) || 0) + 1);
      }
    });
    // Worth offering only if some option would actually narrow the list.
    const narrows = [...coverage.values()].some((n) => n < items.length);
    if (!labels.size || !narrows) continue;

    const selected = selection[facet.key] || [];
    const options = [...labels.entries()]
      .map(([value, label]) => ({
        value,
        label,
        count: indexed.filter((index) => index[facet.key].has(value) && matches(index, selection, facet.key)).length,
        selected: selected.includes(value),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
    facets.push({ key: facet.key, title: facet.title, options });
  }
  return facets;
}

function sortItems(items, sort) {
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'en', { numeric: true });
  const copy = [...items];
  if (sort === SORTS.NEWEST) {
    return copy.sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) || 0 : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) || 0 : 0;
      return tb - ta || byTitle(a, b);
    });
  }
  return copy.sort(byTitle);
}

/** Filter (OR within a facet, AND across) and sort. Never mutates `items`. */
export function applyFilters(items, selection = emptySelection(), ctx = {}) {
  const kept = items.filter((item) => matches(indexItem(item, ctx), selection));
  return sortItems(kept, selection.sort || DEFAULT_SORT);
}

/** True when "Newest" is a meaningful sort for these items. */
export function hasDates(items) {
  return items.some((i) => i.createdAt);
}

const VALUE_PATTERN = /^[a-z0-9-]{1,40}$/;

/** Parse URLSearchParams (or a plain object) into a selection. Unknown/garbage values are dropped. */
export function selectionFromSearchParams(params) {
  const get = (key) => (typeof params?.get === 'function' ? params.get(key) : params?.[key]);
  const selection = emptySelection();
  for (const key of FACET_KEYS) {
    const raw = get(key);
    const str = Array.isArray(raw) ? raw.join(',') : raw;
    if (typeof str !== 'string' || !str) continue;
    selection[key] = [...new Set(str.split(',').map((v) => v.trim().toLowerCase()).filter((v) => VALUE_PATTERN.test(v)))];
  }
  const sort = get('sort');
  selection.sort = Object.values(SORTS).includes(sort) ? sort : DEFAULT_SORT;
  return selection;
}

/** Selection -> URLSearchParams, omitting empties and the default sort. Preserves unrelated params. */
export function toSearchParams(selection, base) {
  const params = new URLSearchParams(base ? base.toString() : '');
  for (const key of [...FACET_KEYS, 'sort']) params.delete(key);
  for (const key of FACET_KEYS) {
    if (selection[key]?.length) params.set(key, selection[key].join(','));
  }
  if (selection.sort && selection.sort !== DEFAULT_SORT) params.set('sort', selection.sort);
  return params;
}

/** Toggle one option, returning a new selection. */
export function toggleOption(selection, key, value) {
  const current = selection[key] || [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return { ...selection, [key]: next };
}
