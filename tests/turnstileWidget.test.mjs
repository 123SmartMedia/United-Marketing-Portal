import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';

import { setupDom, teardownDom, installTurnstileStub, render } from './helpers/dom.mjs';
import TurnstileWidget, { TURNSTILE_UNAVAILABLE_MESSAGE } from '../src/components/wizard/TurnstileWidget.jsx';

/**
 * Component tests for the Turnstile widget.
 *
 * These exist because of a production incident: the component returned `null`
 * when `siteKey` was empty, so a missing TURNSTILE_SITE_KEY produced
 * a page with no visible challenge and an enabled Submit button. Every pure-logic
 * test passed; nothing rendered. The assertions below are about what the user
 * actually sees.
 *
 * Cloudflare's script is never loaded — window.turnstile is stubbed.
 * The site key is Cloudflare's published "always passes" test key, not a secret.
 */

const TEST_SITE_KEY = '1x00000000000000000000AA';

test.beforeEach(() => setupDom());
test.afterEach(() => teardownDom());

test('the widget renders a visible challenge container when a site key exists', async () => {
  const turnstile = installTurnstileStub();
  const view = await render(React.createElement(TurnstileWidget, { siteKey: TEST_SITE_KEY }));

  assert.ok(view.byTestId('turnstile-widget'), 'the widget wrapper must be in the DOM');
  assert.ok(view.byTestId('turnstile-container'), 'the challenge container must be in the DOM');
  assert.match(view.text(), /Verify you’re human/);
  assert.equal(turnstile.renders.length, 1, 'exactly one widget must be rendered');
});

test('a missing site key shows the configuration error instead of rendering nothing', async () => {
  installTurnstileStub();
  const view = await render(React.createElement(TurnstileWidget, { siteKey: '' }));

  // The regression guard: the component must never return null here.
  assert.notEqual(view.html(), '', 'the component must not render empty');
  assert.ok(view.byTestId('turnstile-unavailable'), 'the unavailable block must be shown');
  assert.equal(view.text().includes(TURNSTILE_UNAVAILABLE_MESSAGE), true);
  assert.match(
    view.text(),
    /Verification is temporarily unavailable\. Please contact the marketing desk\./
  );
  // It is an alert, so assistive tech announces it.
  assert.ok(view.find('[role="alert"]'));
});

test('a missing site key reports unavailability to the parent', async () => {
  installTurnstileStub();
  const reasons = [];
  await render(
    React.createElement(TurnstileWidget, { siteKey: '', onUnavailable: (r) => reasons.push(r) })
  );
  assert.deepEqual(reasons, ['missing_site_key']);
});

test('a missing site key never loads or renders a Cloudflare widget', async () => {
  const turnstile = installTurnstileStub();
  await render(React.createElement(TurnstileWidget, { siteKey: '' }));
  assert.equal(turnstile.renders.length, 0);
  assert.equal(globalThis.document.getElementById('cf-turnstile-script'), null);
});

test('the widget is configured as a Managed, always-visible challenge', async () => {
  const turnstile = installTurnstileStub();
  await render(
    React.createElement(TurnstileWidget, { siteKey: TEST_SITE_KEY, action: 'marketing_request' })
  );

  const { options } = turnstile.latest();
  assert.equal(options.sitekey, TEST_SITE_KEY);
  assert.equal(options.action, 'marketing_request');
  // Never 'invisible' or 'interaction-only' — the user must see the challenge.
  assert.equal(options.appearance, 'always');
  assert.equal(options.theme, 'light');
});

test('the success callback hands the exact token to the parent', async () => {
  const turnstile = installTurnstileStub();
  const tokens = [];
  await render(
    React.createElement(TurnstileWidget, { siteKey: TEST_SITE_KEY, onToken: (t) => tokens.push(t) })
  );

  await turnstile.succeed('token-abc-123');
  assert.deepEqual(tokens, ['token-abc-123']);
});

test('expiry, timeout and error all clear the token through onExpire', async () => {
  for (const fire of ['expired-callback', 'timeout-callback', 'error-callback']) {
    const turnstile = installTurnstileStub();
    let expired = 0;
    await render(
      React.createElement(TurnstileWidget, { siteKey: TEST_SITE_KEY, onExpire: () => { expired += 1; } })
    );
    const { options } = turnstile.latest();
    assert.equal(typeof options[fire], 'function', `${fire} must be wired`);
    options[fire]();
    assert.equal(expired, 1, `${fire} must clear the token`);
  }
});

test('a reset signal resets the Cloudflare widget and clears the parent token', async () => {
  const turnstile = installTurnstileStub();
  const tokens = [];
  const view = await render(
    React.createElement(TurnstileWidget, {
      siteKey: TEST_SITE_KEY,
      onToken: (t) => tokens.push(t),
      resetSignal: 0,
    })
  );

  await turnstile.succeed('spent-token');
  assert.deepEqual(tokens, ['spent-token']);

  // The parent bumps resetSignal after a failed submission.
  await view.rerender(
    React.createElement(TurnstileWidget, {
      siteKey: TEST_SITE_KEY,
      onToken: (t) => tokens.push(t),
      resetSignal: 1,
    })
  );

  assert.equal(turnstile.resets.length, 1, 'the widget must be reset');
  assert.equal(tokens[tokens.length - 1], '', 'the spent token must be cleared');
});

test('unmounting removes the widget and clears the token it minted', async () => {
  // Navigating back a step unmounts the widget. turnstile.remove() invalidates
  // the token, so the parent must not keep holding one that looks valid.
  const turnstile = installTurnstileStub();
  let expired = 0;
  const view = await render(
    React.createElement(TurnstileWidget, { siteKey: TEST_SITE_KEY, onExpire: () => { expired += 1; } })
  );

  await turnstile.succeed('token-then-navigate-away');
  await view.unmount();

  assert.equal(turnstile.removes.length, 1, 'the Cloudflare widget must be removed');
  assert.equal(expired, 1, 'the stale token must be cleared on unmount');
});

test('the widget is not rendered twice when the component re-renders', async () => {
  const turnstile = installTurnstileStub();
  const view = await render(React.createElement(TurnstileWidget, { siteKey: TEST_SITE_KEY }));

  // A parent state change (an error message appearing) must not duplicate it.
  await view.rerender(React.createElement(TurnstileWidget, { siteKey: TEST_SITE_KEY, error: 'boom' }));
  await view.rerender(React.createElement(TurnstileWidget, { siteKey: TEST_SITE_KEY, error: 'boom again' }));

  assert.equal(turnstile.renders.length, 1, `rendered ${turnstile.renders.length} widgets, expected 1`);
});

test('a server-side error message is displayed on the widget', async () => {
  installTurnstileStub();
  const view = await render(
    React.createElement(TurnstileWidget, {
      siteKey: TEST_SITE_KEY,
      error: 'Your verification expired. Please complete the challenge again and resubmit.',
    })
  );
  assert.match(view.text(), /Your verification expired/);
  assert.ok(view.find('[role="alert"]'));
});

test('the widget never renders the secret key or any secret-shaped value', async () => {
  installTurnstileStub();
  const view = await render(
    React.createElement(TurnstileWidget, { siteKey: TEST_SITE_KEY, action: 'marketing_request' })
  );
  const html = view.html();
  // The site key is public by design; a secret key never reaches this component.
  assert.ok(!html.includes('TURNSTILE_SECRET_KEY'));
  assert.ok(!/[0-9]x0{10,}/.test(html), 'a secret-shaped key appeared in the markup');
});
