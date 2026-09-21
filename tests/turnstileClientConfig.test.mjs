import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getTurnstileClientConfig,
  SITE_KEY_ENV_VAR,
  DEFAULT_ACTION,
} from '../src/lib/turnstileClientConfig.js';

/**
 * The site key must come from a RUNTIME variable.
 *
 * Next.js replaces every `process.env.NEXT_PUBLIC_*` reference with a string
 * literal during `next build` — in server code as well as client code. A page
 * marked `force-dynamic` therefore still serves the build-time value for such a
 * variable, which is exactly how production ended up rendering an empty site key
 * after the key had been added in Vercel.
 *
 * `TURNSTILE_SITE_KEY` carries no prefix, so it survives as a real lookup and a
 * dynamic Server Component reads it per request. These tests pin that, and the
 * source assertions below fail if anyone reintroduces the prefixed name.
 *
 * Site keys used here are Cloudflare's published test keys, not secrets.
 */

const TEST_SITE_KEY = '1x00000000000000000000AA';

test('the authoritative variable is TURNSTILE_SITE_KEY, not a NEXT_PUBLIC_ one', () => {
  assert.equal(SITE_KEY_ENV_VAR, 'TURNSTILE_SITE_KEY');
  assert.ok(
    !SITE_KEY_ENV_VAR.startsWith('NEXT_PUBLIC_'),
    'a NEXT_PUBLIC_ variable is frozen at build time and cannot be rotated at runtime'
  );
});

test('the site key is read from TURNSTILE_SITE_KEY', () => {
  const config = getTurnstileClientConfig({ TURNSTILE_SITE_KEY: TEST_SITE_KEY });
  assert.equal(config.siteKey, TEST_SITE_KEY);
  assert.equal(config.configured, true);
});

test('NEXT_PUBLIC_TURNSTILE_SITE_KEY is ignored entirely', () => {
  // A stale value left behind in Vercel must not quietly keep working, or the
  // deprecation never actually happens.
  const config = getTurnstileClientConfig({
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '2x00000000000000000000AB',
  });
  assert.equal(config.siteKey, '');
  assert.equal(config.configured, false);
});

test('TURNSTILE_SITE_KEY wins even when the deprecated variable is also set', () => {
  const config = getTurnstileClientConfig({
    TURNSTILE_SITE_KEY: TEST_SITE_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '2x00000000000000000000AB',
  });
  assert.equal(config.siteKey, TEST_SITE_KEY);
});

test('an absent site key reports unconfigured rather than throwing', () => {
  for (const env of [{}, { TURNSTILE_SITE_KEY: '' }, { TURNSTILE_SITE_KEY: '   ' }]) {
    const config = getTurnstileClientConfig(env);
    assert.equal(config.siteKey, '');
    assert.equal(config.configured, false, 'the client must fail closed, not silently proceed');
  }
});

test('a pasted key with stray whitespace or a duplicated line is cleaned', () => {
  assert.equal(getTurnstileClientConfig({ TURNSTILE_SITE_KEY: `  ${TEST_SITE_KEY}  ` }).siteKey, TEST_SITE_KEY);
  assert.equal(
    getTurnstileClientConfig({ TURNSTILE_SITE_KEY: `${TEST_SITE_KEY}\n${TEST_SITE_KEY}` }).siteKey,
    TEST_SITE_KEY
  );
});

test('the action falls back through EXPECTED_ACTION, the legacy alias, then the default', () => {
  assert.equal(
    getTurnstileClientConfig({ TURNSTILE_EXPECTED_ACTION: 'custom_action' }).action,
    'custom_action'
  );
  assert.equal(getTurnstileClientConfig({ TURNSTILE_ACTION: 'legacy_action' }).action, 'legacy_action');
  assert.equal(getTurnstileClientConfig({}).action, DEFAULT_ACTION);
  assert.equal(DEFAULT_ACTION, 'marketing_request');
});

test('the client config never exposes the secret key', () => {
  const config = getTurnstileClientConfig({
    TURNSTILE_SITE_KEY: TEST_SITE_KEY,
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  });
  const serialized = JSON.stringify(config);
  assert.ok(!serialized.includes('1x0000000000000000000000000000000AA'), 'the secret key leaked');
  assert.equal(config.secretKey, undefined);
  assert.deepEqual(Object.keys(config).sort(), ['action', 'configured', 'siteKey']);
});

// --- source-level guards ----------------------------------------------------

test('the config module does not reference the secret key at all', () => {
  const source = readFileSync('src/lib/turnstileClientConfig.js', 'utf8');
  // The doc comment explains why it is absent; no code may read it.
  assert.ok(
    !/env\.TURNSTILE_SECRET_KEY|process\.env\.TURNSTILE_SECRET_KEY/.test(source),
    'the client config module must never read TURNSTILE_SECRET_KEY'
  );
});

test('no client component reads TURNSTILE_SECRET_KEY', () => {
  for (const file of [
    'src/components/RequestWizard.jsx',
    'src/components/wizard/TurnstileWidget.jsx',
    'src/components/wizard/FileDropzone.jsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/process\.env\.TURNSTILE_SECRET_KEY/.test(source),
      `${file} must never read the secret key`
    );
  }
});

test('the page is dynamically rendered and uses the runtime config', () => {
  const source = readFileSync('src/app/custom-requests/page.jsx', 'utf8');

  // 1. Dynamic, or the env read collapses back to build time.
  assert.match(source, /export const dynamic = 'force-dynamic'/);
  // 2. It goes through the runtime config module.
  assert.match(source, /getTurnstileClientConfig/);
  // 3. And never through the build-frozen variable.
  assert.ok(
    !/process\.env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY/.test(source),
    'the page must not read the build-frozen NEXT_PUBLIC_ variable'
  );
  // 4. The secret is never read, so it can never become a prop. The page's doc
  //    comment names the variable to explain its absence, so this checks for an
  //    actual `process.env` read rather than any mention of the name.
  assert.ok(
    !/process\.env\.TURNSTILE_SECRET_KEY/.test(source),
    'the page must not read the secret key'
  );
  assert.ok(
    !/turnstileSecret|secretKey/i.test(source),
    'the page must not pass anything secret-shaped as a prop'
  );
});

test('no source file reads NEXT_PUBLIC_TURNSTILE_SITE_KEY any more', () => {
  // The deprecated variable is removed from code, not merely unused in one place.
  for (const file of [
    'src/app/custom-requests/page.jsx',
    'src/lib/turnstile.js',
    'src/lib/turnstileClientConfig.js',
    'src/components/RequestWizard.jsx',
    'src/components/wizard/TurnstileWidget.jsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/process\.env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY|env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY/.test(source),
      `${file} still reads the deprecated NEXT_PUBLIC_TURNSTILE_SITE_KEY`
    );
  }
});

test('.env.example documents the runtime variable and deprecates the old one', () => {
  const source = readFileSync('.env.example', 'utf8');
  assert.match(source, /^TURNSTILE_SITE_KEY=/m, 'TURNSTILE_SITE_KEY must be present and uncommented');
  assert.match(source, /DEPRECATED/, 'the old variable must be marked deprecated');
  assert.ok(
    !/^NEXT_PUBLIC_TURNSTILE_SITE_KEY=/m.test(source),
    'the deprecated variable must no longer be an active entry'
  );
  assert.match(source, /^TURNSTILE_SECRET_KEY=/m);
});
