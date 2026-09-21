import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateAttachments,
  sanitizeFilename,
  matchesDeclaredType,
  attachFilesToRequest,
  ATTACHMENT_ERRORS,
} from '../src/lib/jira/attachments.js';
import { MAX_FILES } from '../src/lib/requestSchema.js';
import { randomUUID } from 'node:crypto';

import { isValidUploadKey, createRequestUploadKey, extensionFromKey } from '../src/lib/r2Uploads.js';

/** Keys now live inside one request's namespace, so every mint needs a request id. */
const REQUEST_ID = randomUUID();
const newKey = () => createRequestUploadKey(REQUEST_ID);

const KEY_PNG = 'requests/2026-09-21/2b3a1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png';
const KEY_PNG_2 = 'requests/2026-09-21/9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f.png';
const KEY_PNG_3 = 'requests/2026-09-21/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e.png';
const KEY_PNG_4 = 'requests/2026-09-21/2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5f.png';
const KEY_PDF = 'requests/2026-09-21/11112222-3333-4444-5555-666677778888.pdf';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const file = (over = {}) => ({ name: 'headshot.png', size: PNG_MAGIC.length, type: 'image/png', key: KEY_PNG, ...over });

const CONFIG = {
  authMode: 'scoped_token',
  apiBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-1',
  siteUrl: 'https://example.atlassian.net',
  cloudId: 'cloud-1',
  token: 'secret',
  serviceDeskId: '42',
  timeoutMs: 1000,
  attachmentsEnabled: true,
};

const UPLOADS = {
  accountId: 'acct',
  accessKeyId: 'ak',
  secretAccessKey: 'sk',
  bucket: 'umc-request-uploads',
  usingPublicAssetBucket: false,
  configured: true,
};

async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

/** Minimal stand-in for the S3 client: records commands, returns canned bytes. */
function fakeR2({ bytes = PNG_MAGIC, failGet = false } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      const name = command.constructor.name;
      calls.push({ name, input: command.input });
      if (name === 'GetObjectCommand') {
        if (failGet) throw new Error('NoSuchKey');
        return {
          ContentLength: bytes.length,
          Body: { transformToByteArray: async () => new Uint8Array(bytes) },
        };
      }
      return {};
    },
  };
}

// --- object keys -----------------------------------------------------------

test('a minted upload key is random, prefixed, and carries no filename', () => {
  const key = newKey();
  // marketing-requests/<requestUUID>/<randomUUID> — no date, no extension, and
  // nothing derived from what the user uploaded.
  assert.match(key, /^marketing-requests\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  assert.ok(key.startsWith(`marketing-requests/${REQUEST_ID}/`));
  assert.equal(isValidUploadKey(key), true);
  // Current keys carry no extension, so there is none to read back.
  assert.equal(extensionFromKey(key), null);
  // Two calls never collide.
  assert.notEqual(newKey(), newKey());
});

test('keys outside our own minted shape are rejected', () => {
  const bad = [
    'requests/2026-09-21/../../etc/passwd',
    'admin/uploads/2026-09-21/2b3a1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png',
    'requests/2026-09-21/headshot.png',
    'requests/2026-09-21/2b3a1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.exe',
    '',
    null,
  ];
  for (const key of bad) assert.equal(isValidUploadKey(key), false, `expected ${key} to be rejected`);
});

test('an unsupported content type mints no key at all', () => {
  assert.equal(createRequestUploadKey('not-a-uuid'), null);
});

// --- metadata validation ---------------------------------------------------

test('no attachments is valid', () => {
  assert.deepEqual(validateAttachments(undefined), { ok: true, files: [] });
  assert.deepEqual(validateAttachments([]), { ok: true, files: [] });
});

test('a well-formed attachment passes and is normalized', () => {
  const result = validateAttachments([file()]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.files[0], {
    name: 'headshot.png',
    size: PNG_MAGIC.length,
    type: 'image/png',
    key: KEY_PNG,
  });
});

test('more than the allowed number of files is rejected', () => {
  const many = Array.from({ length: MAX_FILES + 1 }, () => file({ key: newKey() }));
  assert.deepEqual(validateAttachments(many), { ok: false, error: ATTACHMENT_ERRORS.TOO_MANY });
});

test('exceeding the total size budget is rejected', () => {
  // The combined budget is 30MB, so this needs four legal 9MB files rather than
  // the two 6MB files that used to exceed the old 10MB budget.
  const big = [
    file({ size: 9 * 1024 * 1024, key: KEY_PNG }),
    file({ size: 9 * 1024 * 1024, key: KEY_PNG_2 }),
    file({ size: 9 * 1024 * 1024, key: KEY_PNG_3 }),
    file({ size: 9 * 1024 * 1024, key: KEY_PNG_4 }),
  ];
  assert.equal(validateAttachments(big).error, ATTACHMENT_ERRORS.TOO_LARGE);
});

test('a single file over the per-file cap is rejected', () => {
  assert.equal(validateAttachments([file({ size: 11 * 1024 * 1024 })]).error, ATTACHMENT_ERRORS.INVALID_FILE);
});

test('an unsupported MIME type is rejected', () => {
  assert.equal(
    validateAttachments([file({ name: 'notes.docx', type: 'application/msword' })]).error,
    ATTACHMENT_ERRORS.UNSUPPORTED_TYPE
  );
});

test('an executable is rejected even when it claims an allowed MIME type', () => {
  assert.equal(
    validateAttachments([file({ name: 'payload.exe', type: 'application/pdf', key: KEY_PDF })]).error,
    ATTACHMENT_ERRORS.UNSUPPORTED_TYPE
  );
});

test('a mismatched filename extension and MIME type is rejected', () => {
  assert.equal(
    validateAttachments([file({ name: 'flyer.pdf', type: 'image/png' })]).error,
    ATTACHMENT_ERRORS.UNSUPPORTED_TYPE
  );
});

test('a key whose extension disagrees with the declared type is rejected', () => {
  assert.equal(
    validateAttachments([file({ name: 'flyer.pdf', type: 'application/pdf', key: KEY_PNG })]).error,
    ATTACHMENT_ERRORS.UNTRUSTED_SOURCE
  );
});

test('an empty or malformed file is rejected', () => {
  assert.equal(validateAttachments([file({ size: 0 })]).error, ATTACHMENT_ERRORS.INVALID_FILE);
  assert.equal(validateAttachments([file({ size: 'big' })]).error, ATTACHMENT_ERRORS.INVALID_FILE);
});

test('the same object cannot be submitted twice in one request', () => {
  assert.equal(validateAttachments([file(), file()]).error, ATTACHMENT_ERRORS.INVALID_FILE);
});

test('a forged or foreign object reference is rejected', () => {
  const forged = [
    'https://cdn.example.com/requests/2026-09-21/x.png',
    'requests/2026-09-21/x.png',
    '../../admin/uploads/secret.pdf',
  ];
  for (const key of forged) {
    assert.equal(
      validateAttachments([file({ key })]).error,
      ATTACHMENT_ERRORS.UNTRUSTED_SOURCE,
      `expected ${key} to be rejected`
    );
  }
});

test('filenames are sanitized of path separators and unusual characters', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('my logo (final).png'), 'my_logo__final_.png');
  assert.equal(sanitizeFilename('....'), 'attachment');
  assert.equal(sanitizeFilename(''), 'attachment');
  assert.ok(sanitizeFilename('a'.repeat(400)).length <= 120);
});

// --- byte-level checks -----------------------------------------------------

test('declared content types are checked against the actual leading bytes', () => {
  assert.equal(matchesDeclaredType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), true);
  assert.equal(matchesDeclaredType(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
  assert.equal(matchesDeclaredType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true);
  // An executable renamed to .png does not survive.
  assert.equal(matchesDeclaredType(Buffer.from('MZ\x90\x00'), 'image/png'), false);
  assert.equal(matchesDeclaredType(Buffer.from('%PDF-1.7'), 'image/png'), false);
});

test('bytes that do not match the declared type are not sent to Jira', async () => {
  const r2 = fakeR2({ bytes: Buffer.from('MZ\x90\x00\x00\x00\x00\x00\x00\x00') });
  await withFetch(
    () => {
      throw new Error('Jira must not be called');
    },
    async () => {
      const result = await attachFilesToRequest('MKT-1', [file()], {
        config: CONFIG,
        uploadsConfig: UPLOADS,
        r2Client: r2,
      });
      assert.equal(result.attached, 0);
      assert.equal(result.error, 'attachment_upload_failed');
    }
  );
});

test('a byte count that disagrees with the declared size is rejected', async () => {
  const r2 = fakeR2();
  await withFetch(
    () => {
      throw new Error('Jira must not be called');
    },
    async () => {
      const result = await attachFilesToRequest('MKT-1', [file({ size: 999 })], {
        config: CONFIG,
        uploadsConfig: UPLOADS,
        r2Client: r2,
      });
      assert.equal(result.attached, 0);
    }
  );
});

// --- the Jira sequence -----------------------------------------------------

test('the supported order is followed and the staged object is then deleted', async () => {
  const r2 = fakeR2();
  const calls = [];
  await withFetch(
    async (url, init) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('attachTemporaryFile')) {
        assert.equal(init.headers['X-Atlassian-Token'], 'no-check');
        return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 'tmp-1' }] }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    },
    async () => {
      const result = await attachFilesToRequest('MKT-1', [file()], {
        config: CONFIG,
        uploadsConfig: UPLOADS,
        r2Client: r2,
      });

      assert.equal(result.attached, 1);
      assert.equal(result.failed, 0);
      assert.equal(result.error, null);

      // attachTemporaryFile, then the permanent attach.
      assert.ok(calls[0].includes('attachTemporaryFile'));
      assert.ok(calls[1].includes('/request/MKT-1/attachment'));

      // The object was read, then deleted.
      assert.deepEqual(
        r2.calls.map((c) => c.name),
        ['GetObjectCommand', 'DeleteObjectCommand']
      );
      assert.equal(r2.calls[1].input.Key, KEY_PNG);
      assert.equal(r2.calls[1].input.Bucket, UPLOADS.bucket);
    }
  );
});

test('the permanent attach marks the files visible to the reporter', async () => {
  const r2 = fakeR2();
  let attachBody = null;
  await withFetch(
    async (url, init) => {
      const href = String(url);
      if (href.includes('attachTemporaryFile')) {
        return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 'tmp-9' }] }), {
          status: 201,
        });
      }
      attachBody = JSON.parse(init.body);
      return new Response('{}', { status: 201 });
    },
    async () => {
      await attachFilesToRequest('MKT-1', [file()], { config: CONFIG, uploadsConfig: UPLOADS, r2Client: r2 });
      assert.deepEqual(attachBody.temporaryAttachmentIds, ['tmp-9']);
      assert.equal(attachBody.public, true);
    }
  );
});

test('a partial failure reports the real count and keeps the unattached object', async () => {
  const good = file({ key: KEY_PNG });
  const bad = file({ name: 'broken.png', key: KEY_PNG_2, size: 4 }); // size mismatch
  const r2 = fakeR2();

  await withFetch(
    async (url) => {
      if (String(url).includes('attachTemporaryFile')) {
        return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 'tmp-1' }] }), {
          status: 201,
        });
      }
      return new Response('{}', { status: 201 });
    },
    async () => {
      const result = await attachFilesToRequest('MKT-1', [good, bad], {
        config: CONFIG,
        uploadsConfig: UPLOADS,
        r2Client: r2,
      });

      assert.equal(result.attached, 1);
      assert.equal(result.failed, 1);
      assert.equal(result.error, 'attachment_partial_failure');

      // Only the attached object is deleted; the failed one is left for the
      // lifecycle rule / a retry.
      const deleted = r2.calls.filter((c) => c.name === 'DeleteObjectCommand').map((c) => c.input.Key);
      assert.deepEqual(deleted, [KEY_PNG]);
    }
  );
});

test('a Jira upload failure leaves every object in place for the retry window', async () => {
  const r2 = fakeR2();
  await withFetch(
    async () => new Response(JSON.stringify({ errorMessages: ['nope'] }), { status: 500 }),
    async () => {
      const result = await attachFilesToRequest('MKT-1', [file()], {
        config: CONFIG,
        uploadsConfig: UPLOADS,
        r2Client: r2,
      });
      assert.equal(result.attached, 0);
      assert.equal(result.failed, 1);
      assert.equal(result.error, 'attachment_upload_failed');
      assert.equal(r2.calls.filter((c) => c.name === 'DeleteObjectCommand').length, 0);
    }
  );
});

test('a failed permanent attach does not delete the staged objects', async () => {
  const r2 = fakeR2();
  await withFetch(
    async (url) => {
      if (String(url).includes('attachTemporaryFile')) {
        return new Response(JSON.stringify({ temporaryAttachments: [{ temporaryAttachmentId: 'tmp-1' }] }), {
          status: 201,
        });
      }
      return new Response('{}', { status: 500 });
    },
    async () => {
      const result = await attachFilesToRequest('MKT-1', [file()], {
        config: CONFIG,
        uploadsConfig: UPLOADS,
        r2Client: r2,
      });
      assert.equal(result.attached, 0);
      assert.equal(result.error, 'attachment_attach_failed');
      assert.equal(r2.calls.filter((c) => c.name === 'DeleteObjectCommand').length, 0);
    }
  );
});

test('an unreadable staged object is counted as failed, not a crash', async () => {
  const r2 = fakeR2({ failGet: true });
  await withFetch(
    () => {
      throw new Error('Jira must not be called');
    },
    async () => {
      const result = await attachFilesToRequest('MKT-1', [file()], {
        config: CONFIG,
        uploadsConfig: UPLOADS,
        r2Client: r2,
      });
      assert.equal(result.error, 'attachment_upload_failed');
      assert.equal(result.failed, 1);
    }
  );
});

test('attachments can be switched off, and unconfigured storage is reported', async () => {
  const off = await attachFilesToRequest('MKT-1', [file()], {
    config: { ...CONFIG, attachmentsEnabled: false },
    uploadsConfig: UPLOADS,
  });
  assert.equal(off.error, 'attachments_disabled');

  const unconfigured = await attachFilesToRequest('MKT-1', [file()], {
    config: CONFIG,
    uploadsConfig: { ...UPLOADS, configured: false },
  });
  assert.equal(unconfigured.error, 'attachment_storage_unavailable');
});

// --- leak checks -----------------------------------------------------------

test('object keys never reach the log output on failure', async () => {
  const messages = [];
  const originalError = console.error;
  console.error = (...args) => messages.push(JSON.stringify(args));
  const r2 = fakeR2({ failGet: true });
  try {
    await withFetch(
      () => {
        throw new Error('Jira must not be called');
      },
      async () => {
        await attachFilesToRequest('MKT-1', [file()], {
          config: CONFIG,
          uploadsConfig: UPLOADS,
          r2Client: r2,
        });
      }
    );
  } finally {
    console.error = originalError;
  }

  const combined = messages.join('\n');
  assert.ok(combined.length > 0, 'expected a failure to be logged');
  assert.ok(!combined.includes(KEY_PNG), 'the object key was written to the log');
  assert.ok(!combined.includes('requests/'), 'a key prefix was written to the log');
  // The filename is fine — it is user-supplied display text, not a locator.
  assert.ok(combined.includes('headshot.png'));
});
