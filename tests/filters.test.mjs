import test from 'node:test';
import assert from 'node:assert/strict';

import catalog from '../src/content/catalog.json' with { type: 'json' };
import {
  applyFilters,
  deriveFacets,
  emptySelection,
  isFiltering,
  activeCount,
  selectionFromSearchParams,
  toSearchParams,
  toggleOption,
  hasDates,
  toValue,
  SORTS,
} from '../src/lib/filters.js';

const file = (type, extra = {}) => ({ name: 'x', type, ext: type, style: null, brand: null, lang: null, ...extra });

const ITEMS = [
  { slug: 'fthb', title: 'FTHB Flyer', category: 'flyers', categoryTitle: 'Program Flyers', files: [file('pdf', { lang: 'English', brand: 'Generic', style: 'Classic' }), file('pdf', { lang: 'Spanish', brand: 'Cobranded', style: 'Color-Pop' })] },
  { slug: 'va', title: 'VA Flyer', category: 'flyers', categoryTitle: 'Program Flyers', files: [file('pdf', { lang: 'English', brand: 'Generic', style: 'Classic' })] },
  { slug: 'va-video', title: 'VA Video', category: 'videos', categoryTitle: 'Program Videos', files: [file('video')] },
  { slug: 'xmas', title: 'Christmas Post', category: 'social', categoryTitle: 'Social Media', group: 'holidays', createdAt: '2026-09-20T00:00:00Z', files: [file('image')] },
];

const facetMap = (facets) => Object.fromEntries(facets.map((f) => [f.key, f.options.map((o) => `${o.value}:${o.count}`)]));

test('toValue makes URL-safe option values', () => {
  assert.equal(toValue('Color-Pop'), 'color-pop');
  assert.equal(toValue('Style 02'), 'style-02');
  assert.equal(toValue('Word doc'), 'word-doc');
});

test('deriveFacets builds facets from real metadata with counts', () => {
  const f = facetMap(deriveFacets(ITEMS));
  assert.deepEqual(f.category, ['program-flyers:2', 'program-videos:1', 'social-media:1']);
  assert.deepEqual(f.type, ['image:1', 'pdf:2', 'video:1']);
  assert.deepEqual(f.lang, ['english:2', 'spanish:1']);
  assert.deepEqual(f.brand, ['co-branded:1', 'generic:2']);
  assert.deepEqual(f.style, ['classic:2', 'color-pop:1']);
  assert.equal(f.group, undefined, 'topic facet needs groupTitles context');
});

test('a facet every item shares is not offered', () => {
  const onlyPdfs = ITEMS.slice(0, 2);
  const keys = deriveFacets(onlyPdfs).map((f) => f.key);
  assert.ok(!keys.includes('type'));
  assert.ok(!keys.includes('category'));
  assert.ok(keys.includes('lang'), 'Spanish only covers one item, so language narrows');
});

test('topic facet uses the category group titles, defaulting missing groups to "other"', () => {
  const items = [{ ...ITEMS[3] }, { slug: 'misc', title: 'Misc', files: [file('image')] }];
  const f = facetMap(deriveFacets(items, emptySelection(), { groupTitles: { holidays: 'Holidays & Seasonal', other: 'Other' } }));
  assert.deepEqual(f.group, ['holidays-seasonal:1', 'other:1']);
});

test('applyFilters: OR within a facet, AND across facets', () => {
  let sel = toggleOption(emptySelection(), 'type', 'pdf');
  sel = toggleOption(sel, 'type', 'video');
  assert.deepEqual(applyFilters(ITEMS, sel).map((i) => i.slug), ['fthb', 'va', 'va-video']);

  sel = toggleOption(sel, 'lang', 'spanish');
  assert.deepEqual(applyFilters(ITEMS, sel).map((i) => i.slug), ['fthb']);
});

test('faceted counts reflect the other facets selections', () => {
  const sel = toggleOption(emptySelection(), 'lang', 'spanish');
  const f = Object.fromEntries(deriveFacets(ITEMS, sel).map((x) => [x.key, x.options]));
  assert.equal(f.type.find((o) => o.value === 'pdf').count, 1);
  assert.equal(f.type.find((o) => o.value === 'video').count, 0);
  // Own facet ignores itself so you can widen the selection.
  assert.equal(f.lang.find((o) => o.value === 'english').count, 2);
  assert.equal(f.lang.find((o) => o.value === 'spanish').selected, true);
});

test('sorting: A–Z by default, Newest puts dated items first', () => {
  assert.deepEqual(applyFilters(ITEMS).map((i) => i.slug), ['xmas', 'fthb', 'va', 'va-video']);
  const newest = applyFilters(ITEMS, { ...emptySelection(), sort: SORTS.NEWEST });
  assert.equal(newest[0].slug, 'xmas');
  assert.equal(hasDates(ITEMS), true);
  assert.equal(hasDates(ITEMS.slice(0, 3)), false);
});

test('applyFilters does not mutate its input', () => {
  const copy = JSON.parse(JSON.stringify(ITEMS));
  applyFilters(ITEMS, toggleOption(emptySelection(), 'type', 'pdf'));
  assert.deepEqual(ITEMS, copy);
});

test('URL round-trip keeps selections, drops defaults and preserves other params', () => {
  let sel = toggleOption(emptySelection(), 'type', 'pdf');
  sel = toggleOption(sel, 'lang', 'spanish');
  sel = { ...sel, sort: SORTS.NEWEST };
  const params = toSearchParams(sel, new URLSearchParams('utm=x'));
  assert.equal(params.toString(), 'utm=x&type=pdf&lang=spanish&sort=newest');
  assert.deepEqual(selectionFromSearchParams(params), sel);
  assert.equal(toSearchParams(emptySelection()).toString(), '');
});

test('selectionFromSearchParams ignores garbage and unknown sorts', () => {
  const sel = selectionFromSearchParams(new URLSearchParams('type=pdf,<script>,PDF,pdf&sort=hax&lang='));
  assert.deepEqual(sel.type, ['pdf']);
  assert.equal(sel.sort, SORTS.AZ);
  assert.deepEqual(sel.lang, []);
  assert.deepEqual(selectionFromSearchParams({ type: ['pdf', 'video'] }).type, ['pdf', 'video']);
});

test('isFiltering / activeCount', () => {
  assert.equal(isFiltering(emptySelection()), false);
  assert.equal(isFiltering({ ...emptySelection(), sort: SORTS.NEWEST }), true);
  assert.equal(activeCount(toggleOption(toggleOption(emptySelection(), 'type', 'pdf'), 'lang', 'english')), 2);
});

test('against the real catalog: every derived option filters to exactly its count', () => {
  const items = catalog.categories.flatMap((c) => c.items.map((i) => ({ ...i, category: c.slug, categoryTitle: c.title })));
  const facets = deriveFacets(items);
  assert.ok(facets.length >= 4, 'expected category, type, language, branding, style facets');
  for (const facet of facets) {
    for (const opt of facet.options) {
      const n = applyFilters(items, toggleOption(emptySelection(), facet.key, opt.value)).length;
      assert.equal(n, opt.count, `${facet.key}=${opt.value}`);
    }
  }
});
