import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FAVORITES_KEY,
  MAX_FAVORITES,
  favoriteKey,
  toEntry,
  parseFavorites,
  hasFavorite,
  toggleFavorite,
  removeFavorite,
  createFavoritesStore,
} from '../src/lib/favorites.js';
import { groupByRecency } from '../src/lib/whatsNew.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const ITEM = { slug: 'va-flyer', title: 'VA Flyer', thumbnail: 'Program-Flyers/va.png', files: [] };

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

function eventTarget() {
  const handlers = new Set();
  return {
    addEventListener: (_type, h) => handlers.add(h),
    removeEventListener: (_type, h) => handlers.delete(h),
    dispatch: (event) => handlers.forEach((h) => h(event)),
    get size() {
      return handlers.size;
    },
  };
}

// ---------------------------------------------------------------- pure helpers

test('toEntry keeps what a card needs to render', () => {
  assert.deepEqual(toEntry(ITEM, 'program-flyers', NOW), {
    category: 'program-flyers',
    slug: 'va-flyer',
    title: 'VA Flyer',
    thumbnail: 'Program-Flyers/va.png',
    addedAt: NOW.toISOString(),
  });
  assert.equal(toEntry({ slug: 's', title: 't' }, 'c', NOW).thumbnail, null);
});

test('parseFavorites tolerates garbage, drops malformed and duplicate entries', () => {
  assert.deepEqual(parseFavorites(null), []);
  assert.deepEqual(parseFavorites('not json'), []);
  assert.deepEqual(parseFavorites('{"a":1}'), []);
  const raw = JSON.stringify([
    { category: 'a', slug: 'x', title: 'X' },
    { category: 'a', slug: 'x', title: 'X again' },
    { category: '', slug: 'y', title: 'bad' },
    { slug: 'z', title: 'no category' },
    null,
    { category: 'b', slug: 'y', title: 'Y', thumbnail: 42 },
  ]);
  const list = parseFavorites(raw);
  assert.deepEqual(list.map((e) => favoriteKey(e.category, e.slug)), ['a/x', 'b/y']);
  assert.equal(list[1].thumbnail, null);
});

test('toggleFavorite adds newest first, removes on second toggle, never mutates', () => {
  const a = toEntry(ITEM, 'program-flyers', NOW);
  const b = toEntry({ ...ITEM, slug: 'fha' }, 'program-flyers', NOW);
  const empty = Object.freeze([]);
  const one = toggleFavorite(empty, a);
  const two = toggleFavorite(one, b);
  assert.deepEqual(two.map((e) => e.slug), ['fha', 'va-flyer']);
  assert.equal(hasFavorite(two, 'program-flyers', 'va-flyer'), true);
  assert.deepEqual(toggleFavorite(two, a).map((e) => e.slug), ['fha']);
  assert.equal(one.length, 1);
  assert.deepEqual(removeFavorite(two, 'program-flyers', 'nope'), two);
});

test('toggleFavorite caps the kit size', () => {
  let list = [];
  for (let i = 0; i < MAX_FAVORITES + 5; i += 1) list = toggleFavorite(list, toEntry({ slug: `s${i}`, title: 't' }, 'c', NOW));
  assert.equal(list.length, MAX_FAVORITES);
  assert.equal(list[0].slug, `s${MAX_FAVORITES + 4}`);
});

// ---------------------------------------------------------------- store

test('store persists to storage and keeps snapshots referentially stable', () => {
  const storage = memoryStorage();
  const store = createFavoritesStore({ getStorage: () => storage });
  const first = store.getSnapshot();
  assert.equal(store.getSnapshot(), first, 'unchanged storage → same array');

  store.toggle(toEntry(ITEM, 'program-flyers', NOW));
  const after = store.getSnapshot();
  assert.notEqual(after, first);
  assert.equal(after.length, 1);
  assert.equal(store.getSnapshot(), after);
  assert.equal(JSON.parse(storage.getItem(FAVORITES_KEY))[0].slug, 'va-flyer');

  store.remove('program-flyers', 'va-flyer');
  assert.equal(store.getSnapshot().length, 0);
});

test('store notifies subscribers on change and on cross-tab storage events', () => {
  const storage = memoryStorage();
  const target = eventTarget();
  const store = createFavoritesStore({ getStorage: () => storage, target });
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });
  assert.equal(target.size, 1);

  store.toggle(toEntry(ITEM, 'c', NOW));
  assert.equal(calls, 1);

  // Another tab writes the key.
  storage.setItem(FAVORITES_KEY, JSON.stringify([]));
  target.dispatch({ key: FAVORITES_KEY });
  assert.equal(calls, 2);
  assert.equal(store.getSnapshot().length, 0);

  target.dispatch({ key: 'something-else' });
  assert.equal(calls, 2, 'unrelated keys are ignored');

  unsubscribe();
  assert.equal(target.size, 0, 'listener removed when nobody subscribes');
});

test('store keeps working in memory when storage throws (private mode / blocked)', () => {
  const store = createFavoritesStore({
    getStorage: () => {
      throw new Error('SecurityError');
    },
  });
  assert.deepEqual(store.getSnapshot(), []);
  store.toggle(toEntry(ITEM, 'c', NOW));
  assert.equal(store.getSnapshot().length, 1);
  store.clear();
  assert.equal(store.getSnapshot().length, 0);
});

test('server snapshot is always empty', () => {
  const store = createFavoritesStore({ getStorage: () => memoryStorage({ [FAVORITES_KEY]: '[{"category":"a","slug":"b","title":"c"}]' }) });
  assert.deepEqual(store.getServerSnapshot(), []);
});

// ---------------------------------------------------------------- what's new grouping

test('groupByRecency sorts newest first and buckets by age', () => {
  const day = 86400000;
  const at = (daysAgo) => new Date(NOW.getTime() - daysAgo * day).toISOString();
  const groups = groupByRecency(
    [
      { slug: 'old', createdAt: at(45) },
      { slug: 'today', createdAt: at(0.1) },
      { slug: 'mid', createdAt: at(12) },
      { slug: 'recent', createdAt: at(3) },
      { slug: 'undated' },
    ],
    NOW.getTime()
  );
  assert.deepEqual(
    groups.map((g) => [g.title, g.items.map((i) => i.slug)]),
    [
      ['This week', ['today', 'recent']],
      ['Earlier this month', ['mid']],
      ['Older', ['old', 'undated']],
    ]
  );
  assert.deepEqual(groupByRecency([], NOW.getTime()), []);
});
