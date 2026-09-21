import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  validateFileMetadata,
  validateFileSet,
  sanitizeFilename,
  hasDoubleExtension,
  extensionOf,
  UPLOAD_ERRORS,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  ACCEPTED_UPLOAD_TYPES,
} from '../src/lib/uploadRules.js';

import {
  createRequestUploadKey,
  isValidUploadKey,
  keyBelongsToRequest,
  extensionFromKey,
  UPLOAD_PREFIX,
} from '../src/lib/r2Uploads.js';

const png = (over = {}) => ({ name: 'logo.png', size: 2048, type: 'image/png', ...over });

// --- limits -----------------------------------------------------------------

test('the documented limits are what the code actually enforces', () => {
  assert.equal(MAX_FILES, 5);
  assert.equal(MAX_FILE_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_TOTAL_BYTES, 30 * 1024 * 1024);
  assert.deepEqual([...ACCEPTED_UPLOAD_TYPES].sort(), ['application/pdf', 'image/jpeg', 'image/png']);
});

test('a valid file passes and comes back sanitized', () => {
  const result = validateFileMetadata(png());
  assert.equal(result.ok, true);
  assert.deepEqual(result.file, { name: 'logo.png', size: 2048, type: 'image/png' });
});

test('an empty file is rejected', () => {
  assert.equal(validateFileMetadata(png({ size: 0 })).error, UPLOAD_ERRORS.EMPTY_FILE);
  assert.equal(validateFileMetadata(png({ size: -1 })).error, UPLOAD_ERRORS.EMPTY_FILE);
  assert.equal(validateFileMetadata(png({ size: NaN })).error, UPLOAD_ERRORS.EMPTY_FILE);
  assert.equal(validateFileMetadata(png({ size: 'big' })).error, UPLOAD_ERRORS.EMPTY_FILE);
});

test('a file over 10MB is rejected', () => {
  assert.equal(validateFileMetadata(png({ size: MAX_FILE_BYTES + 1 })).error, UPLOAD_ERRORS.FILE_TOO_LARGE);
  assert.equal(validateFileMetadata(png({ size: MAX_FILE_BYTES })).ok, true);
});

test('an unsupported MIME type is rejected', () => {
  for (const type of ['application/zip', 'text/html', 'image/svg+xml', 'application/x-msdownload', '']) {
    assert.equal(validateFileMetadata(png({ type })).error, UPLOAD_ERRORS.UNSUPPORTED_TYPE, type);
  }
});

test('an executable extension is rejected regardless of declared MIME type', () => {
  // The classic attack: claim image/png, ship an .exe.
  for (const name of ['payload.exe', 'run.bat', 'a.sh', 'x.ps1', 'app.jar', 'evil.js', 'page.html', 'vec.svg']) {
    const result = validateFileMetadata(png({ name }));
    assert.equal(result.ok, false, `${name} was accepted`);
    assert.ok(
      [UPLOAD_ERRORS.BLOCKED_EXTENSION, UPLOAD_ERRORS.EXTENSION_MISMATCH].includes(result.error),
      `${name} gave ${result.error}`
    );
  }
});

test('double extensions are rejected', () => {
  assert.equal(hasDoubleExtension('invoice.exe.pdf'), true);
  assert.equal(hasDoubleExtension('photo.jpg.pdf'), true);
  assert.equal(hasDoubleExtension('doc.php.png'), true);
  assert.equal(validateFileMetadata({ name: 'invoice.exe.pdf', size: 10, type: 'application/pdf' }).error,
    UPLOAD_ERRORS.DOUBLE_EXTENSION);
});

test('an ordinary dotted filename is NOT mistaken for a double extension', () => {
  // A version-style segment is not a file extension, so it must still work.
  assert.equal(hasDoubleExtension('Q3-report.v2.pdf'), false);
  assert.equal(hasDoubleExtension('logo.final.png'), false);
  assert.equal(validateFileMetadata({ name: 'Q3-report.v2.pdf', size: 10, type: 'application/pdf' }).ok, true);
});

test('the extension must agree with the declared MIME type', () => {
  assert.equal(validateFileMetadata({ name: 'logo.png', size: 10, type: 'application/pdf' }).error,
    UPLOAD_ERRORS.EXTENSION_MISMATCH);
  // jpg and jpeg both pair with image/jpeg.
  assert.equal(validateFileMetadata({ name: 'p.jpg', size: 10, type: 'image/jpeg' }).ok, true);
  assert.equal(validateFileMetadata({ name: 'p.jpeg', size: 10, type: 'image/jpeg' }).ok, true);
});

test('filenames are sanitized: no path traversal, no control characters, bounded length', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('C:\\Windows\\System32\\cmd.exe'), 'cmd.exe');
  assert.equal(sanitizeFilename('.hidden'), 'hidden');
  assert.equal(sanitizeFilename('a\u0000b.png'), 'ab.png');
  assert.equal(sanitizeFilename('réservé (1).png'), 'r_serv__1_.png');
  assert.ok(sanitizeFilename(`${'x'.repeat(500)}.png`).length <= 120);
  assert.equal(sanitizeFilename(''), 'attachment');
  assert.equal(sanitizeFilename(null), 'attachment');
});

test('a sanitized name never contains a path separator', () => {
  for (const name of ['../a.png', 'a/b/c.png', 'a\\b.png', '..\\..\\x.png']) {
    const safe = sanitizeFilename(name);
    assert.ok(!safe.includes('/') && !safe.includes('\\'), `${name} -> ${safe}`);
  }
});

test('extensionOf reads the final extension only', () => {
  assert.equal(extensionOf('a.b.PNG'), 'png');
  assert.equal(extensionOf('noext'), '');
});

// --- the set ----------------------------------------------------------------

test('more than 5 files is rejected', () => {
  const files = Array.from({ length: MAX_FILES + 1 }, () => png());
  assert.equal(validateFileSet(files).error, UPLOAD_ERRORS.TOO_MANY);
  assert.equal(validateFileSet(Array.from({ length: MAX_FILES }, () => png())).ok, true);
});

test('a combined size over 30MB is rejected even when each file is legal', () => {
  const eightMB = 8 * 1024 * 1024;
  // 4 x 8MB = 32MB: every file is under the 10MB cap, the set is over 30MB.
  const files = Array.from({ length: 4 }, () => png({ size: eightMB }));
  assert.equal(validateFileSet(files).error, UPLOAD_ERRORS.TOTAL_TOO_LARGE);
  assert.equal(validateFileSet(files.slice(0, 3)).ok, true);
});

test('an empty or absent file list is valid', () => {
  assert.deepEqual(validateFileSet([]), { ok: true, files: [] });
  assert.deepEqual(validateFileSet(undefined), { ok: true, files: [] });
  assert.deepEqual(validateFileSet('not-an-array'), { ok: true, files: [] });
});

test('the first bad file stops the set and names itself', () => {
  const result = validateFileSet([png(), png({ name: 'bad.exe' })]);
  assert.equal(result.ok, false);
  assert.equal(result.fileName, 'bad.exe');
});

// --- object keys ------------------------------------------------------------

test('a minted key uses the required marketing-requests/{requestUUID}/{randomUUID} shape', () => {
  const requestId = randomUUID();
  const key = createRequestUploadKey(requestId);
  assert.match(key, /^marketing-requests\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  assert.ok(key.startsWith(`${UPLOAD_PREFIX}${requestId}/`));
  assert.equal(isValidUploadKey(key), true);
});

test('a minted key contains no part of the filename or MIME type', () => {
  const key = createRequestUploadKey(randomUUID());
  assert.ok(!key.includes('logo'));
  assert.ok(!key.includes('png'));
  assert.ok(!key.includes('.'), 'the key must carry no extension');
});

test('two keys for the same request are distinct', () => {
  const requestId = randomUUID();
  assert.notEqual(createRequestUploadKey(requestId), createRequestUploadKey(requestId));
});

test('a key cannot be minted for anything that is not a UUID', () => {
  for (const bad of ['../etc', 'abc', '', null, '../../x', `${randomUUID()}/..`]) {
    assert.equal(createRequestUploadKey(bad), null, String(bad));
  }
});

test('unexpected object keys are rejected', () => {
  for (const bad of [
    'marketing-requests/../../secret',
    'marketing-requests/abc/def',
    'assets/logo.png',
    '/marketing-requests/x/y',
    'marketing-requests//y',
    `marketing-requests/${randomUUID()}/${randomUUID()}/extra`,
    `marketing-requests/${randomUUID()}/${randomUUID()}.pdf`,
    '',
    null,
    42,
  ]) {
    assert.equal(isValidUploadKey(bad), false, `${String(bad)} was accepted`);
  }
});

test('a key from another request is rejected even though it is well-formed', () => {
  const mine = randomUUID();
  const theirs = randomUUID();
  const theirKey = createRequestUploadKey(theirs);
  // Well-formed in isolation...
  assert.equal(isValidUploadKey(theirKey), true);
  // ...but not inside my namespace.
  assert.equal(keyBelongsToRequest(theirKey, mine), false);
  assert.equal(keyBelongsToRequest(createRequestUploadKey(mine), mine), true);
});

test('legacy single-stage keys still validate so old objects can be read and deleted', () => {
  const legacy = `requests/2026-09-21/${randomUUID()}.pdf`;
  assert.equal(isValidUploadKey(legacy), true);
  assert.equal(extensionFromKey(legacy), 'pdf');
  // The new format carries no extension, so the cross-check is skipped for it.
  assert.equal(extensionFromKey(createRequestUploadKey(randomUUID())), null);
  // A legacy key belongs to no request namespace.
  assert.equal(keyBelongsToRequest(legacy, randomUUID()), false);
});
