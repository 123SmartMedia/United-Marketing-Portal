import 'server-only';

import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

/**
 * Temporary request-attachment storage in Cloudflare R2.
 * ------------------------------------------------------
 * These objects are a staging area between the browser and Jira, not a
 * durable store and not a public file host.
 *
 * Invariants:
 *  - The bucket is PRIVATE. Nothing here builds a public URL, and the browser
 *    never receives one. The only URL the client ever sees is a short-lived
 *    presigned PUT for the upload itself.
 *  - Object keys are random (UUID) and carry no part of the user's filename, so
 *    a key reveals nothing and cannot be guessed.
 *  - The server reads bytes back through the S3 API with its own credentials —
 *    never over HTTP from a public host — which also removes the SSRF surface
 *    that a fetch-by-URL design would have.
 *  - Objects are deleted as soon as Jira has the file, and a lifecycle rule
 *    (scripts/set-r2-lifecycle.mjs) expires anything left behind.
 */

// Env values pasted into a dashboard can pick up stray whitespace or an
// accidental duplicate line. Take the first non-empty line, trimmed.
const cleanEnv = (value) =>
  (value || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';

/** How long an un-attached upload may survive. Mirrored by the R2 lifecycle rule. */
export const UPLOAD_RETENTION_DAYS = 2;

/** Extensions we will ever mint a key for, keyed by accepted MIME type. */
export const EXTENSION_BY_TYPE = Object.freeze({
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
});

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Prefix for the two-stage wizard flow. A lifecycle rule scoped to exactly this
 * prefix expires anything the application did not clean up itself — see
 * scripts/set-r2-lifecycle.mjs. It is deliberately NOT the bucket root, so a
 * short expiry can never reach other objects.
 */
export const UPLOAD_PREFIX = 'marketing-requests/';

/** `marketing-requests/<requestUUID>/<randomUUID>` — the current format. */
const REQUEST_KEY_PATTERN = new RegExp(`^marketing-requests/${UUID}/${UUID}$`);

/**
 * `requests/<date>/<uuid>.<ext>` — the single-stage format.
 * Still accepted so an object staged by an older deploy can still be read and
 * deleted; nothing mints this shape any more.
 */
const LEGACY_KEY_PATTERN = new RegExp(`^requests/\\d{4}-\\d{2}-\\d{2}/${UUID}\\.(pdf|png|jpg)$`);

/**
 * Mint an object key inside one request's namespace.
 *
 * The key is two random UUIDs and carries NO part of the filename, the MIME
 * type or anything else the user supplied: a key leaks nothing and cannot be
 * guessed. The display filename travels in the form payload instead, and the
 * content type is pinned by the presigned PUT and re-checked with HeadObject.
 */
export function createRequestUploadKey(requestId) {
  if (typeof requestId !== 'string' || !new RegExp(`^${UUID}$`).test(requestId)) return null;
  return `${UPLOAD_PREFIX}${requestId}/${randomUUID()}`;
}

/**
 * A key is only usable if this server could have minted it. Rejects traversal,
 * other prefixes, and anything shaped by user input.
 */
export function isValidUploadKey(key) {
  return typeof key === 'string' && (REQUEST_KEY_PATTERN.test(key) || LEGACY_KEY_PATTERN.test(key));
}

/** True when `key` sits inside this specific request's namespace. */
export function keyBelongsToRequest(key, requestId) {
  return (
    isValidUploadKey(key) &&
    typeof requestId === 'string' &&
    key.startsWith(`${UPLOAD_PREFIX}${requestId}/`)
  );
}

/**
 * Extension embedded in a LEGACY key, used to cross-check the declared type.
 * Current keys carry no extension by design, so this returns null for them and
 * callers fall back to the HeadObject content-type check instead.
 */
export function extensionFromKey(key) {
  return LEGACY_KEY_PATTERN.test(key || '') ? key.slice(key.lastIndexOf('.') + 1) : null;
}

/**
 * R2 credentials for the uploads bucket.
 *
 * R2_UPLOADS_BUCKET should be a dedicated PRIVATE bucket with no public r2.dev
 * domain and no custom domain. It falls back to R2_BUCKET so an existing
 * deployment keeps working, but that bucket is public (it serves the asset
 * catalog) — `usingPublicAssetBucket` flags it so callers can warn.
 */
export function getUploadsConfig(env = process.env) {
  const accountId = cleanEnv(env.R2_ACCOUNT_ID);
  const accessKeyId = cleanEnv(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = cleanEnv(env.R2_SECRET_ACCESS_KEY);
  const uploadsBucket = cleanEnv(env.R2_UPLOADS_BUCKET);
  const assetBucket = cleanEnv(env.R2_BUCKET);
  const bucket = uploadsBucket || assetBucket;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    usingPublicAssetBucket: !uploadsBucket && Boolean(assetBucket),
    configured: Boolean(accountId && accessKeyId && secretAccessKey && bucket),
  };
}

export function createR2Client(config) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

/**
 * Read an uploaded object's bytes with the server's own credentials.
 * Throws a plain Error whose message is a short code — callers must not surface
 * it, and it never contains the key.
 */
export async function readUploadObject(key, { config, client, maxBytes }) {
  if (!isValidUploadKey(key)) throw new Error('invalid_key');

  const s3 = client || createR2Client(config);
  const result = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));

  const contentLength = Number(result?.ContentLength);
  if (Number.isFinite(contentLength) && maxBytes && contentLength > maxBytes) {
    throw new Error('object_too_large');
  }

  const bytes = await result.Body.transformToByteArray();
  const buffer = Buffer.from(bytes);
  if (!buffer.length) throw new Error('empty_object');
  if (maxBytes && buffer.length > maxBytes) throw new Error('object_too_large');
  return buffer;
}

/**
 * Inspect a staged object WITHOUT downloading it.
 *
 * The browser's declared size and content type are claims; R2 holds the truth.
 * HeadObject is how finalize checks the two agree before a single byte is read,
 * so an oversized or mistyped object is rejected without ever being buffered
 * into the lambda.
 *
 * Returns { ok: true, size, contentType } or { ok: false, error } — never throws
 * and never includes the key in the error.
 */
export async function headUploadObject(key, { config, client }) {
  if (!isValidUploadKey(key)) return { ok: false, error: 'invalid_key' };
  try {
    const s3 = client || createR2Client(config);
    const result = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    const size = Number(result?.ContentLength);
    return {
      ok: true,
      size: Number.isFinite(size) ? size : 0,
      contentType: String(result?.ContentType || ''),
    };
  } catch (err) {
    // A never-uploaded object is the common case (the user abandoned the file),
    // so it is reported as a distinct outcome rather than a hard failure.
    const name = err?.name || err?.Code || '';
    if (name === 'NotFound' || name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return { ok: false, error: 'not_found' };
    }
    return { ok: false, error: 'head_failed' };
  }
}

/**
 * Remove a staged upload. Best effort: a failed delete is not worth failing a
 * submission over, because the lifecycle rule will expire the object anyway.
 * Returns true when the object is gone.
 */
export async function deleteUploadObject(key, { config, client }) {
  if (!isValidUploadKey(key)) return false;
  try {
    const s3 = client || createR2Client(config);
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch {
    // Deliberately silent: logging here would have to name the key.
    return false;
  }
}
