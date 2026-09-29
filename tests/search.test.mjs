import test from 'node:test';
import assert from 'node:assert/strict';

import { searchItems, indexItems, tokenize, buildHaystack } from '../src/lib/search.js';

const item = (title, extra = {}) => ({
  title,
  slug: title.toLowerCase().replace(/\W+/g, '-'),
  category: 'program-flyers',
  categoryTitle: 'Program Flyers',
  types: ['pdf'],
  files: [{ name: `${title}.pdf`, label: 'Download', type: 'pdf', ext: 'pdf', lang: null, brand: null, style: null }],
  ...extra,
});

const ITEMS = [
  item('VA Loan Flyer'),
  item('DSCR Program Overview'),
  item('First Time Homebuyer', {
    files: [
      { name: 'FTHB-English.pdf', label: 'English', type: 'pdf', ext: 'pdf', lang: 'English' },
      { name: 'FTHB-Spanish.pdf', label: 'Spanish', type: 'pdf', ext: 'pdf', lang: 'Spanish' },
    ],
  }),
  item('2-1 Buydown Explainer', {
    category: 'program-videos',
    categoryTitle: 'Program Videos',
    types: ['video'],
    files: [{ name: 'Buydown.mp4', label: 'Download', type: 'video', ext: 'mp4' }],
  }),
  item('Holiday Post', {
    category: 'social-media',
    categoryTitle: 'Social Media',
    types: ['image'],
    caption: 'Happy Thanksgiving from our team',
    hashtags: ['#homeownership', '#thankful'],
    files: [{ name: 'holiday.png', label: 'Download', type: 'image', ext: 'png' }],
  }),
];

const titles = (list) => list.map((i) => i.title);

test('empty query returns nothing', () => {
  assert.deepEqual(searchItems(ITEMS, '   '), []);
});

test('all terms must match (AND)', () => {
  assert.deepEqual(titles(searchItems(ITEMS, 'va flyer')), ['VA Loan Flyer']);
  assert.deepEqual(searchItems(ITEMS, 'va dscr'), []);
});

test('matches file language, type and extension', () => {
  assert.deepEqual(titles(searchItems(ITEMS, 'spanish')), ['First Time Homebuyer']);
  assert.deepEqual(titles(searchItems(ITEMS, 'español')), ['First Time Homebuyer']);
  assert.deepEqual(titles(searchItems(ITEMS, 'video')), ['2-1 Buydown Explainer']);
  assert.deepEqual(titles(searchItems(ITEMS, 'mp4')), ['2-1 Buydown Explainer']);
});

test('matches captions and hashtags, with or without #', () => {
  assert.deepEqual(titles(searchItems(ITEMS, 'thanksgiving')), ['Holiday Post']);
  assert.deepEqual(titles(searchItems(ITEMS, '#thankful')), ['Holiday Post']);
});

test('title hits rank above category-only hits', () => {
  const list = [item('Overview of Programs', { categoryTitle: 'Brochures' }), item('Rate Sheet', { categoryTitle: 'Program Flyers' })];
  assert.equal(searchItems(list, 'program')[0].title, 'Overview of Programs');
});

test('returns every match — no silent cap', () => {
  const many = Array.from({ length: 60 }, (_, i) => item(`Flyer ${i}`));
  assert.equal(searchItems(many, 'flyer').length, 60);
});

test('precomputed index gives the same results', () => {
  assert.deepEqual(titles(searchItems(indexItems(ITEMS), 'spanish')), titles(searchItems(ITEMS, 'spanish')));
});

test('tokenize lower-cases, strips accents and #', () => {
  assert.deepEqual(tokenize('  Español  #VA '), ['espanol', 'va']);
  assert.match(buildHaystack(ITEMS[2]), /spanish/);
});
