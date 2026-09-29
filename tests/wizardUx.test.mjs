import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';

import { setupDom, teardownDom, installTurnstileStub, render, act } from './helpers/dom.mjs';
import RequestWizard from '../src/components/RequestWizard.jsx';
import {
  sanitizeDraft,
  hasContent,
  readDraft,
  writeDraft,
  clearDraft,
  readContact,
  writeContact,
  DRAFT_KEY,
  CONTACT_KEY,
  TE_CONTACT_KEY,
} from '../src/components/wizard/wizardStorage.js';
import { businessDaysBetween, isRushDate } from '../src/components/wizard/businessDays.js';

/** Minimal Storage stand-in for the pure helpers. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

const throwingStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

// ---------------------------------------------------------------- business days

test('businessDaysBetween counts weekdays after the start date', () => {
  assert.equal(businessDaysBetween('2026-10-05', '2026-10-05'), 0); // Mon → Mon
  assert.equal(businessDaysBetween('2026-10-05', '2026-10-06'), 1); // Mon → Tue
  assert.equal(businessDaysBetween('2026-10-09', '2026-10-12'), 1); // Fri → Mon
  assert.equal(businessDaysBetween('2026-10-05', '2026-10-14'), 7); // Mon → next Wed
  assert.equal(businessDaysBetween('2026-10-05', '2026-10-01'), null); // past
  assert.equal(businessDaysBetween('2026-10-05', 'nope'), null);
});

test('isRushDate flags dates under 7 business days away', () => {
  assert.equal(isRushDate('2026-10-13', '2026-10-05'), true); // 6 business days
  assert.equal(isRushDate('2026-10-14', '2026-10-05'), false); // 7 business days
  assert.equal(isRushDate('', '2026-10-05'), false);
});

// ---------------------------------------------------------------- storage helpers

test('sanitizeDraft never keeps files, the honeypot or tokens', () => {
  const draft = sanitizeDraft({
    name: 'Jane',
    rush: true,
    files: [{ name: 'a.pdf' }],
    company: 'bot',
    turnstileToken: 'secret',
    submissionId: 'abc',
    weird: { nested: true },
  });
  assert.deepEqual(draft, { name: 'Jane', rush: true });
});

test('contact fields alone do not count as a draft', () => {
  assert.equal(hasContent({ name: 'Jane', email: 'j@unitedmortgage.com' }), false);
  assert.equal(hasContent({ name: 'Jane', projectTitle: 'Postcard' }), true);
  assert.equal(hasContent({ rush: false, projectTitle: '  ' }), false);
});

test('draft round-trips through storage and clears', () => {
  const store = memoryStorage();
  writeDraft({ projectTitle: 'Postcard', files: [{ name: 'x' }] }, store);
  assert.deepEqual(readDraft(store), { projectTitle: 'Postcard' });
  clearDraft(store);
  assert.equal(readDraft(store), null);
});

test('storage failures never throw', () => {
  assert.doesNotThrow(() => writeDraft({ projectTitle: 'x' }, throwingStorage));
  assert.equal(readDraft(throwingStorage), null);
  assert.doesNotThrow(() => clearDraft(throwingStorage));
  assert.deepEqual(readContact(throwingStorage), {});
  assert.equal(readDraft(memoryStorage({ [DRAFT_KEY]: '{not json' })), null);
});

test('contact merges the Total Expert record, with this form winning', () => {
  const store = memoryStorage({
    [TE_CONTACT_KEY]: JSON.stringify({ name: 'From TE', nmls: '999', role: 'ignored' }),
  });
  assert.deepEqual(readContact(store), { name: 'From TE', nmls: '999' });
  writeContact({ name: 'Jane', email: 'j@unitedmortgage.com', projectTitle: 'not contact' }, store);
  assert.deepEqual(JSON.parse(store.getItem(CONTACT_KEY)), { name: 'Jane', email: 'j@unitedmortgage.com' });
  assert.deepEqual(readContact(store), { name: 'Jane', nmls: '999', email: 'j@unitedmortgage.com' });
});

// ---------------------------------------------------------------- component

const SITE_KEY = '1x00000000000000000000AA';
const mount = () =>
  render(React.createElement(RequestWizard, { turnstileSiteKey: SITE_KEY, turnstileAction: 'marketing_request' }));

const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)));
const button = (view, pattern) => view.findAll('button').find((b) => pattern.test(b.textContent));

test.beforeEach(() => {
  setupDom();
  window.sessionStorage.clear();
  window.localStorage.clear();
  installTurnstileStub();
});
test.afterEach(() => {
  teardownDom();
  delete globalThis.fetch;
});

test('typing saves a draft that a fresh wizard restores, with a notice', async () => {
  const first = await mount();
  await first.type(first.find('#branch'), 'Melville, NY');
  await first.type(first.find('#requestType'), 'Digital Asset Creation');
  await wait(500);
  assert.equal(JSON.parse(window.sessionStorage.getItem(DRAFT_KEY)).requestType, 'Digital Asset Creation');
  await first.unmount();

  const second = await mount();
  assert.ok(second.byTestId('draft-restored'), 'the restored-draft notice must show');
  assert.equal(second.find('#requestType').value, 'Digital Asset Creation');

  await second.click(button(second, /Start over/));
  assert.equal(second.byTestId('draft-restored'), null);
  assert.equal(second.find('#requestType').value, '');
  assert.equal(window.sessionStorage.getItem(DRAFT_KEY), null);
});

test('remembered contact details prefill without a draft notice', async () => {
  window.localStorage.setItem(CONTACT_KEY, JSON.stringify({ name: 'Jane Officer', nmls: '1234567' }));
  const view = await mount();
  assert.equal(view.find('#name').value, 'Jane Officer');
  assert.equal(view.find('#nmls').value, '1234567');
  assert.equal(view.byTestId('draft-restored'), null);
});

test('Continue with missing fields shows a linked error summary', async () => {
  const view = await mount();
  await view.click(button(view, /Continue/));
  await wait(30);

  const summary = view.byTestId('error-summary');
  assert.ok(summary, 'an error summary must appear');
  const links = [...summary.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  assert.ok(links.includes('#name') && links.includes('#dateNeeded'), `links: ${links}`);

  await view.click(summary.querySelector('a[href="#email"]'));
  assert.equal(document.activeElement?.id, 'email', 'the link must focus its field');
});

test('a short-notice date auto-checks Rush and explains why', async () => {
  const view = await mount();
  const soon = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await view.type(view.find('#dateNeeded'), soon);
  assert.equal(view.find('#rush').checked, true);
  assert.ok(view.find('#rush-hint'));
});

test('moving to the next step focuses and announces its heading', async () => {
  const view = await mount();
  const future = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  for (const [id, v] of Object.entries({
    name: 'Jane Officer',
    email: 'jofficer@unitedmortgage.com',
    phone: '631-203-7480',
    nmls: '1234567',
    branch: 'Melville, NY',
    requestType: 'Digital Asset Creation',
    dateNeeded: future,
  })) {
    await view.type(view.find(`#${id}`), v);
  }
  await view.click(button(view, /Continue/));
  await wait(30);

  assert.equal(document.activeElement?.tagName, 'H2');
  assert.match(view.byTestId('step-announcer').textContent, /Step 2 of 2: Creative & files/);
  const bar = view.find('[role="progressbar"]');
  assert.equal(bar.getAttribute('aria-valuenow'), '2');
  assert.equal(bar.getAttribute('aria-valuemax'), '2');
});

test('success saves contact, clears the draft, and "Submit another" starts fresh', async () => {
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/init')) return new Response(JSON.stringify({ ok: true, finalizeToken: 'tok', uploads: [] }), { status: 200 });
    if (href.includes('/finalize')) return new Response(JSON.stringify({ ok: true, requestKey: 'MKT-42' }), { status: 201 });
    throw new Error(`unexpected fetch ${href}`);
  };
  const turnstile = installTurnstileStub();
  const view = await mount();
  const future = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  for (const [id, v] of Object.entries({
    name: 'Jane Officer', email: 'jofficer@unitedmortgage.com', phone: '631-203-7480', nmls: '1234567',
    branch: 'Melville, NY', requestType: 'Digital Asset Creation', dateNeeded: future,
  })) await view.type(view.find(`#${id}`), v);
  await view.click(button(view, /Continue/));
  await view.type(view.find('#projectTitle'), 'Fall postcard');
  await view.type(view.find('#keyMessage'), 'Book a valuation.');
  await turnstile.succeed('tok');
  await view.click(view.byTestId('submit-request'));
  await wait(20);

  assert.match(view.text(), /MKT-42/);
  assert.ok(button(view, /Copy ticket number/));
  assert.equal(window.sessionStorage.getItem(DRAFT_KEY), null);
  assert.equal(JSON.parse(window.localStorage.getItem(CONTACT_KEY)).name, 'Jane Officer');

  await view.click(view.byTestId('submit-another'));
  await wait(20);
  assert.equal(view.find('#name').value, 'Jane Officer', 'contact is prefilled');
  assert.equal(view.find('#projectTitle'), null, 'back on step 1');
  assert.equal(view.find('#requestType').value, '', 'request content is cleared');
  assert.equal(document.activeElement?.tagName, 'H2');
});
