import test from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyTurnstileToken,
  getTurnstileConfig,
  isTurnstileEnforced,
  TURNSTILE_RESULTS,
} from '../src/lib/turnstile.js';

/**
 * Turnstile verification.
 *
 * The keys below are Cloudflare's PUBLISHED test keys, documented for exactly
 * this purpose at developers.cloudflare.com/turnstile/troubleshooting/testing.
 * They are not secrets, they work only against Cloudflare's dummy responses, and
 * they grant nothing.
 */
const TEST_KEYS = {
  SITE_ALWAYS_PASSES: '1x00000000000000000000AA',
  SITE_ALWAYS_BLOCKS: '2x00000000000000000000AB',
  SECRET_ALWAYS_PASSES: '1x0000000000000000000000000000000AA',
  SECRET_ALWAYS_FAILS: '2x0000000000000000000000000000000AA',
  SECRET_TOKEN_ALREADY_SPENT: '3x0000000000000000000000000000000AA',
};

const HOSTNAME = 'marketing.unitedmortgage.com';

const config = (over = {}) => ({
  secretKey: TEST_KEYS.SECRET_ALWAYS_PASSES,
  siteKey: TEST_KEYS.SITE_ALWAYS_PASSES,
  expectedHostname: HOSTNAME,
  expectedAction: '',
  timeoutMs: 1000,
  ...over,
});

async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const siteverify = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// --- configuration ---------------------------------------------------------

test('verification is enforced exactly when a secret key is configured', () => {
  assert.equal(isTurnstileEnforced(config()), true);
  assert.equal(isTurnstileEnforced(config({ secretKey: '' })), false);
});

test('config tolerates the whitespace a dashboard paste can introduce', () => {
  const parsed = getTurnstileConfig({
    TURNSTILE_SECRET_KEY: `  ${TEST_KEYS.SECRET_ALWAYS_PASSES}  \n stray-second-line`,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_KEYS.SITE_ALWAYS_PASSES,
    TURNSTILE_EXPECTED_HOSTNAME: HOSTNAME,
  });
  assert.equal(parsed.secretKey, TEST_KEYS.SECRET_ALWAYS_PASSES);
  assert.equal(parsed.expectedHostname, HOSTNAME);
});

test('with no secret configured the check is skipped and loudly warned about', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await withFetch(
      () => {
        throw new Error('siteverify must not be called');
      },
      async () => {
        const result = await verifyTurnstileToken('anything', { config: config({ secretKey: '' }) });
        assert.equal(result.ok, true);
        assert.equal(result.skipped, true);
        assert.equal(result.result, TURNSTILE_RESULTS.NOT_CONFIGURED);
      }
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.match(warnings.join('\n'), /bot protection is DISABLED/i);
});

// --- outcomes --------------------------------------------------------------

test('a valid token on the expected hostname passes', async () => {
  await withFetch(
    async () => siteverify({ success: true, hostname: HOSTNAME }),
    async () => {
      const result = await verifyTurnstileToken('valid-token', { config: config() });
      assert.deepEqual(result, { ok: true, result: TURNSTILE_RESULTS.OK });
    }
  );
});

test('a missing token is rejected without calling Cloudflare', async () => {
  await withFetch(
    () => {
      throw new Error('siteverify must not be called');
    },
    async () => {
      for (const token of ['', '   ', undefined, null, 42]) {
        const result = await verifyTurnstileToken(token, { config: config() });
        assert.equal(result.ok, false);
        assert.equal(result.result, TURNSTILE_RESULTS.MISSING);
      }
    }
  );
});

test('an absurdly long token is rejected before it is sent', async () => {
  await withFetch(
    () => {
      throw new Error('siteverify must not be called');
    },
    async () => {
      const result = await verifyTurnstileToken('x'.repeat(5000), { config: config() });
      assert.equal(result.result, TURNSTILE_RESULTS.MALFORMED);
    }
  );
});

test('a failed challenge is rejected', async () => {
  await withFetch(
    async () => siteverify({ success: false, 'error-codes': ['invalid-input-response'] }),
    async () => {
      const result = await verifyTurnstileToken('bad-token', { config: config() });
      assert.equal(result.ok, false);
      assert.equal(result.result, TURNSTILE_RESULTS.MALFORMED);
    }
  );
});

test('a replayed or expired token is reported as a duplicate', async () => {
  await withFetch(
    async () => siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    async () => {
      const result = await verifyTurnstileToken('spent-token', { config: config() });
      assert.equal(result.ok, false);
      assert.equal(result.result, TURNSTILE_RESULTS.DUPLICATE);
    }
  );
});

test('the same token cannot be redeemed twice', async () => {
  const spent = new Set();
  await withFetch(
    async (_url, init) => {
      const token = new URLSearchParams(init.body).get('response');
      if (spent.has(token)) return siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] });
      spent.add(token);
      return siteverify({ success: true, hostname: HOSTNAME });
    },
    async () => {
      const first = await verifyTurnstileToken('one-shot', { config: config() });
      const second = await verifyTurnstileToken('one-shot', { config: config() });
      assert.equal(first.ok, true);
      assert.equal(second.ok, false);
      assert.equal(second.result, TURNSTILE_RESULTS.DUPLICATE);
    }
  );
});

test('a token solved on another hostname is rejected', async () => {
  await withFetch(
    async () => siteverify({ success: true, hostname: 'phishing.example.com' }),
    async () => {
      const result = await verifyTurnstileToken('valid-elsewhere', { config: config() });
      assert.equal(result.ok, false);
      assert.equal(result.result, TURNSTILE_RESULTS.HOSTNAME_MISMATCH);
    }
  );
});

test('the hostname check is skipped only when no expected hostname is configured', async () => {
  await withFetch(
    async () => siteverify({ success: true, hostname: 'localhost' }),
    async () => {
      const result = await verifyTurnstileToken('t', { config: config({ expectedHostname: '' }) });
      assert.equal(result.ok, true);
    }
  );
});

test('the action is checked when one is configured', async () => {
  await withFetch(
    async () => siteverify({ success: true, hostname: HOSTNAME, action: 'other-form' }),
    async () => {
      const result = await verifyTurnstileToken('t', {
        config: config({ expectedAction: 'custom-request' }),
      });
      assert.equal(result.ok, false);
      assert.equal(result.result, TURNSTILE_RESULTS.ACTION_MISMATCH);
    }
  );

  await withFetch(
    async () => siteverify({ success: true, hostname: HOSTNAME, action: 'custom-request' }),
    async () => {
      const result = await verifyTurnstileToken('t', {
        config: config({ expectedAction: 'custom-request' }),
      });
      assert.equal(result.ok, true);
    }
  );
});

test('a siteverify timeout is reported as a timeout, not a pass', async () => {
  await withFetch(
    async () => {
      const err = new Error('aborted');
      err.name = 'TimeoutError';
      throw err;
    },
    async () => {
      const result = await verifyTurnstileToken('t', { config: config() });
      assert.equal(result.ok, false);
      assert.equal(result.result, TURNSTILE_RESULTS.TIMEOUT);
    }
  );
});

test('a siteverify outage fails closed', async () => {
  for (const impl of [
    async () => siteverify({}, 502),
    async () => new Response('not json', { status: 200 }),
    async () => {
      throw new TypeError('fetch failed');
    },
  ]) {
    await withFetch(impl, async () => {
      const result = await verifyTurnstileToken('t', { config: config() });
      assert.equal(result.ok, false, 'an unreachable siteverify must never pass');
      assert.equal(result.result, TURNSTILE_RESULTS.UNAVAILABLE);
    });
  }
});

// --- what goes over the wire ----------------------------------------------

test('the secret is sent to Cloudflare and nowhere else', async () => {
  let request = null;
  await withFetch(
    async (url, init) => {
      request = { url: String(url), body: new URLSearchParams(init.body) };
      return siteverify({ success: true, hostname: HOSTNAME });
    },
    async () => {
      await verifyTurnstileToken('token-abc', {
        remoteIp: '203.0.113.7',
        idempotencyKey: 'sub-1',
        config: config(),
      });
    }
  );

  assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(request.body.get('secret'), TEST_KEYS.SECRET_ALWAYS_PASSES);
  assert.equal(request.body.get('response'), 'token-abc');
  assert.equal(request.body.get('remoteip'), '203.0.113.7');
  assert.equal(request.body.get('idempotency_key'), 'sub-1');
});

test('an unknown client IP is omitted rather than sent as "unknown"', async () => {
  let body = null;
  await withFetch(
    async (_url, init) => {
      body = new URLSearchParams(init.body);
      return siteverify({ success: true, hostname: HOSTNAME });
    },
    async () => {
      await verifyTurnstileToken('t', { remoteIp: 'unknown', config: config() });
    }
  );
  assert.equal(body.has('remoteip'), false);
});

test('neither the token nor the secret is ever returned to the caller', async () => {
  await withFetch(
    async () => siteverify({ success: false, 'error-codes': ['invalid-input-response'] }),
    async () => {
      const result = await verifyTurnstileToken('super-secret-token', { config: config() });
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes('super-secret-token'));
      assert.ok(!serialized.includes(TEST_KEYS.SECRET_ALWAYS_PASSES));
    }
  );
});
