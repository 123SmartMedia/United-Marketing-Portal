import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';

import { setupDom, teardownDom, installTurnstileStub, render } from './helpers/dom.mjs';
import RequestWizard from '../src/components/RequestWizard.jsx';

/**
 * Wizard-level Turnstile behaviour: what gates Submit, what reaches
 * `/api/jira/requests/init`, and what survives step navigation.
 *
 * `globalThis.fetch` is stubbed, so no request leaves the process: no Jira call,
 * no ticket, no siteverify. The site key is Cloudflare's published test key.
 */

const TEST_SITE_KEY = '1x00000000000000000000AA';
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

function mountWizard(props = {}) {
  return render(
    React.createElement(RequestWizard, {
      turnstileSiteKey: TEST_SITE_KEY,
      turnstileAction: 'marketing_request',
      portalUrl: 'https://unitedmortgage.atlassian.net/servicedesk/customer/portal/68',
      ...props,
    })
  );
}

/** Fill step 1 and advance to the final step. */
async function advanceToFinalStep(view) {
  const set = async (name, value) => {
    const el = view.find(`#${name}`) || view.find(`[name="${name}"]`);
    assert.ok(el, `field ${name} not found`);
    await view.type(el, value);
  };

  await set('name', 'Jane Officer');
  await set('email', 'jofficer@unitedmortgage.com');
  await set('phone', '631-203-7480');
  await set('nmls', '1234567');
  await set('branch', 'Melville, NY');
  await set('requestType', 'Digital Asset Creation'); // no step 2 for this type
  await set('dateNeeded', FUTURE);

  const next = view.findAll('button').find((b) => /Continue/.test(b.textContent));
  assert.ok(next, 'Continue button not found');
  await view.click(next);

  await set('projectTitle', 'Fall farming postcard');
  await set('keyMessage', 'Book a free valuation.');
}

const submitButton = (view) => view.byTestId('submit-request');

/** Capture every fetch call; answer init and finalize with `responses`. */
function stubFetch(responses = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ href, body });

    if (href.includes('/api/jira/requests/init')) {
      return new Response(JSON.stringify(responses.init ?? { ok: false, error: 'turnstile_missing', message: 'nope' }), {
        status: responses.initStatus ?? 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (href.includes('/api/jira/requests/finalize')) {
      return new Response(JSON.stringify(responses.finalize ?? { ok: true, requestKey: 'MKT-1' }), {
        status: responses.finalizeStatus ?? 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  calls.init = () => calls.find((c) => c.href.includes('/init'));
  return calls;
}

test.beforeEach(() => setupDom());
test.afterEach(() => {
  teardownDom();
  delete globalThis.fetch;
});

// --- rendering --------------------------------------------------------------

test('the final step shows a labelled Verification section above Submit', async () => {
  installTurnstileStub();
  const view = await mountWizard();
  await advanceToFinalStep(view);

  const section = view.find('section[aria-labelledby="verification-heading"]');
  assert.ok(section, 'the verification section must exist on the final step');
  assert.match(section.textContent, /Verification/);
  assert.ok(view.byTestId('turnstile-widget'), 'the widget must be inside it');

  // It must come BEFORE the submit button in document order.
  const submit = submitButton(view);
  assert.ok(submit, 'submit button not found');
  const position = section.compareDocumentPosition(submit);
  assert.ok(
    position & globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
    'Submit must appear after the verification section'
  );
});

test('the verification section is not shown on earlier steps', async () => {
  installTurnstileStub();
  const view = await mountWizard();
  assert.equal(view.find('section[aria-labelledby="verification-heading"]'), null);
  assert.equal(view.byTestId('turnstile-widget'), null);
});

// --- submit gating ----------------------------------------------------------

test('Submit is disabled before verification', async () => {
  installTurnstileStub();
  const view = await mountWizard();
  await advanceToFinalStep(view);

  assert.equal(submitButton(view).disabled, true);
  assert.match(view.text(), /Complete the verification above to enable Submit/);
});

test('a successful challenge enables Submit', async () => {
  const turnstile = installTurnstileStub();
  const view = await mountWizard();
  await advanceToFinalStep(view);

  assert.equal(submitButton(view).disabled, true);
  await turnstile.succeed('good-token');
  assert.equal(submitButton(view).disabled, false, 'Submit must enable once a token arrives');
});

test('expiry disables Submit again', async () => {
  const turnstile = installTurnstileStub();
  const view = await mountWizard();
  await advanceToFinalStep(view);

  await turnstile.succeed('good-token');
  assert.equal(submitButton(view).disabled, false);

  await turnstile.expire();
  assert.equal(submitButton(view).disabled, true, 'an expired challenge must disable Submit');
});

test('a challenge error disables Submit', async () => {
  const turnstile = installTurnstileStub();
  const view = await mountWizard();
  await advanceToFinalStep(view);

  await turnstile.succeed('good-token');
  await turnstile.error();
  assert.equal(submitButton(view).disabled, true);
});

// --- missing configuration --------------------------------------------------

test('a missing site key shows the error and keeps Submit disabled', async () => {
  installTurnstileStub();
  const view = await mountWizard({ turnstileSiteKey: '' });
  await advanceToFinalStep(view);

  // This is the production failure: previously the widget vanished and Submit
  // was ENABLED, so the user only found out after filling in the whole form.
  assert.ok(view.byTestId('turnstile-unavailable'));
  assert.match(
    view.text(),
    /Verification is temporarily unavailable\. Please contact the marketing desk\./
  );
  assert.equal(submitButton(view).disabled, true, 'Submit must be disabled without a site key');
  assert.match(view.text(), /Submission is unavailable until verification is restored/);
});

// --- payload ----------------------------------------------------------------

test('the exact token is sent to /api/jira/requests/init as `turnstileToken`', async () => {
  const turnstile = installTurnstileStub();
  const calls = stubFetch({ init: { ok: false, error: 'validation' }, initStatus: 400 });

  const view = await mountWizard();
  await advanceToFinalStep(view);
  await turnstile.succeed('the-exact-token-value');
  await view.click(submitButton(view));

  const init = calls.init();
  assert.ok(init, '/api/jira/requests/init must be called');
  // The property name the server reads is body.turnstileToken — see
  // src/app/api/jira/requests/init/route.js.
  assert.equal(init.body.turnstileToken, 'the-exact-token-value');
  assert.equal(init.body.source, 'wizard');
  assert.ok(init.body.submissionId, 'an idempotency key must travel with it');
});

test('the client property name matches what the init route reads', async () => {
  // Guards against a silent rename on either side.
  const routeSource = await import('node:fs').then((fs) =>
    fs.readFileSync('src/app/api/jira/requests/init/route.js', 'utf8')
  );
  assert.match(routeSource, /body\.turnstileToken/, 'init route must read body.turnstileToken');

  const wizardSource = await import('node:fs').then((fs) =>
    fs.readFileSync('src/components/RequestWizard.jsx', 'utf8')
  );
  assert.match(wizardSource, /turnstileToken,/, 'the wizard must send turnstileToken');
});

test('no submission is attempted while the challenge is unsolved', async () => {
  installTurnstileStub();
  const calls = stubFetch();
  const view = await mountWizard();
  await advanceToFinalStep(view);

  await view.click(submitButton(view));
  assert.equal(calls.length, 0, 'a disabled Submit must not reach the network');
});

// --- single-use token handling ----------------------------------------------

test('a failed submission resets the widget and disables Submit again', async () => {
  const turnstile = installTurnstileStub();
  stubFetch({
    init: { ok: false, error: 'turnstile_duplicate', message: 'Your verification expired.', resetChallenge: true },
    initStatus: 400,
  });

  const view = await mountWizard();
  await advanceToFinalStep(view);
  await turnstile.succeed('single-use-token');
  assert.equal(submitButton(view).disabled, false);

  await view.click(submitButton(view));

  // Turnstile tokens are single use, so the spent one must not be resent.
  assert.equal(turnstile.resets.length, 1, 'the widget must be reset after a failure');
  assert.equal(submitButton(view).disabled, true, 'Submit must be disabled until a new token arrives');
  assert.match(view.text(), /verification expired/i);

  // A fresh token re-enables it.
  await turnstile.succeed('fresh-token');
  assert.equal(submitButton(view).disabled, false);
});

// --- navigation -------------------------------------------------------------

test('navigating back and forward does not leave a stale token behind', async () => {
  const turnstile = installTurnstileStub();
  const view = await mountWizard();
  await advanceToFinalStep(view);

  await turnstile.succeed('token-from-first-visit');
  assert.equal(submitButton(view).disabled, false);

  // Go back. The widget unmounts, which invalidates the token it minted.
  const back = view.findAll('button').find((b) => /Back/.test(b.textContent));
  assert.ok(back, 'Back button not found');
  await view.click(back);
  assert.equal(view.byTestId('turnstile-widget'), null, 'the widget must unmount on back-navigation');

  // Return to the final step.
  const next = view.findAll('button').find((b) => /Continue/.test(b.textContent));
  await view.click(next);

  assert.ok(view.byTestId('turnstile-widget'), 'the widget must mount again');
  assert.equal(
    submitButton(view).disabled,
    true,
    'the invalidated token must not still be enabling Submit'
  );

  // The re-mounted widget mints a fresh token.
  await turnstile.succeed('token-from-second-visit');
  assert.equal(submitButton(view).disabled, false);
});

test('the re-mounted widget is a new Cloudflare widget, not a duplicate', async () => {
  const turnstile = installTurnstileStub();
  const view = await mountWizard();
  await advanceToFinalStep(view);
  assert.equal(turnstile.renders.length, 1);

  const back = view.findAll('button').find((b) => /Back/.test(b.textContent));
  await view.click(back);
  assert.equal(turnstile.removes.length, 1, 'the old widget must be removed');

  const next = view.findAll('button').find((b) => /Continue/.test(b.textContent));
  await view.click(next);
  assert.equal(turnstile.renders.length, 2, 'exactly one new widget must be rendered');
});
