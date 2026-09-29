import 'server-only';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { sortForDisplay } from './postPatch.js';

/**
 * Admin-added pieces (posts) live as a single JSON document in R2 at
 * admin/posts.json. Read server-side via the S3 API (not the cached public URL,
 * so edits appear promptly), written by the authenticated admin routes.
 *
 * Post shape:
 *   { id, title, slug, category, group|null, url, type, fileName,
 *     caption, hashtags[], createdAt, published }
 *
 * Two read paths, on purpose:
 *  - readPosts()        public pages: tolerant, any failure renders as "no posts".
 *  - readPostsStrict()  writes: throws on anything but "not found". A transient
 *    read error must never be mistaken for an empty list, or the following
 *    write would wipe every post.
 *
 * Writes are optimistic read-modify-write with R2 conditional PUTs (If-Match
 * the ETag we read, or If-None-Match: * for a new document), retried on a
 * precondition failure, so two admins saving at once cannot drop each other's
 * change. Same pattern as src/lib/booking/store.js.
 */

const POSTS_KEY = 'admin/posts.json';
const UPLOADS_PREFIX = 'admin/uploads/';
const MAX_WRITE_ATTEMPTS = 4;

export class PostsStoreError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function cleanEnv(v) {
  return (v || '').split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean)[0] || '';
}

export function r2Config() {
  return {
    accountId: cleanEnv(process.env.R2_ACCOUNT_ID),
    accessKeyId: cleanEnv(process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: cleanEnv(process.env.R2_SECRET_ACCESS_KEY),
    bucket: cleanEnv(process.env.R2_BUCKET),
    publicBase: cleanEnv(process.env.NEXT_PUBLIC_ASSET_BASE_URL),
  };
}

export function isR2Configured() {
  const c = r2Config();
  return !!(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket && c.publicBase);
}

function createClient(c) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
}

/** Resolve { config, client }; both injectable for tests. */
function deps(options = {}) {
  const config = options.config || r2Config();
  return { config, client: options.client || createClient(config) };
}

async function streamToString(body) {
  if (typeof body.transformToString === 'function') return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

const isNotFound = (err) => err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;

function isPreconditionFailure(err) {
  const status = err?.$metadata?.httpStatusCode;
  return status === 412 || status === 409 || err?.name === 'PreconditionFailed';
}

export { sortForDisplay };

/**
 * Read for a write. Returns { posts, etag } (etag null when the document does
 * not exist yet). Throws PostsStoreError on any other failure, including
 * unparseable JSON.
 */
export async function readPostsStrict(options = {}) {
  const { config, client } = deps(options);
  let res;
  try {
    res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: POSTS_KEY }));
  } catch (err) {
    if (isNotFound(err)) return { posts: [], etag: null };
    throw new PostsStoreError('read_failed', err?.name || 'unknown');
  }
  let parsed;
  try {
    parsed = JSON.parse(await streamToString(res.Body));
  } catch {
    throw new PostsStoreError('corrupt_document');
  }
  if (!Array.isArray(parsed)) throw new PostsStoreError('corrupt_document');
  return { posts: parsed, etag: res.ETag || null };
}

/** Read all admin posts in display order for public pages. Returns [] on any failure. */
export async function readPosts(options = {}) {
  if (!options.config && !isR2Configured()) return [];
  try {
    return sortForDisplay((await readPostsStrict(options)).posts);
  } catch (err) {
    console.error('[posts] read failed:', err?.code || err?.name || err);
    return [];
  }
}

async function writePosts(posts, etag, { config, client }) {
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: POSTS_KEY,
      Body: JSON.stringify(posts, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-store',
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
    })
  );
}

/**
 * Optimistic read-modify-write. `change(posts)` returns { posts: next, result }
 * to write, or { result } to stop without writing.
 */
async function mutatePosts(change, options) {
  const d = deps(options);
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { posts, etag } = await readPostsStrict(d);
    const outcome = change(posts);
    if (!outcome.posts) return outcome.result;
    try {
      await writePosts(outcome.posts, etag, d);
      return outcome.result;
    } catch (err) {
      if (!isPreconditionFailure(err)) throw new PostsStoreError('write_failed', err?.name || 'unknown');
    }
  }
  throw new PostsStoreError('write_contention');
}

export async function addPost(post, options = {}) {
  return mutatePosts((posts) => ({ posts: [post, ...posts], result: post }), options);
}

/** Remove a post by id. Returns the removed post, or null if it did not exist. */
export async function deletePost(id, options = {}) {
  return mutatePosts((posts) => {
    const target = posts.find((p) => p.id === id);
    if (!target) return { result: null };
    return { posts: posts.filter((p) => p.id !== id), result: target };
  }, options);
}

/** Fields an edit may change. Everything else (id, slug, url, createdAt…) is fixed. */
export const EDITABLE_FIELDS = Object.freeze(['title', 'category', 'group', 'caption', 'hashtags', 'published']);

/**
 * Apply an already-validated patch. Unknown keys are ignored, so a caller can
 * never rewrite a post's id, file URL or slug. Moving to another category
 * drops the manual position (it belonged to the old category's order).
 * Returns { before, after }, or null if the post does not exist.
 */
export async function updatePost(id, patch, options = {}) {
  const allowed = Object.fromEntries(
    Object.entries(patch || {}).filter(([key]) => EDITABLE_FIELDS.includes(key))
  );
  return mutatePosts((posts) => {
    const before = posts.find((p) => p.id === id);
    if (!before) return { result: null };
    const after = { ...before, ...allowed, updatedAt: new Date().toISOString() };
    if (allowed.category && allowed.category !== before.category) delete after.position;
    return { posts: posts.map((p) => (p.id === id ? after : p)), result: { before, after } };
  }, options);
}

/**
 * Set a category's manual order in ONE conditional write. `orderedIds` must be
 * exactly the category's current pieces (no more, no fewer), so a stale admin
 * screen cannot silently drop or duplicate a piece. Returns the category's posts
 * in their new order, or throws PostsStoreError('invalid_order').
 */
export async function reorderPosts(category, orderedIds, options = {}) {
  return mutatePosts((posts) => {
    const inCategory = posts.filter((p) => p.category === category);
    const ids = new Set(orderedIds);
    const sameSet =
      ids.size === orderedIds.length &&
      ids.size === inCategory.length &&
      inCategory.every((p) => ids.has(p.id));
    if (!sameSet) throw new PostsStoreError('invalid_order');
    const position = new Map(orderedIds.map((pid, index) => [pid, index]));
    const next = posts.map((p) => (position.has(p.id) ? { ...p, position: position.get(p.id) } : p));
    return { posts: next, result: sortForDisplay(next.filter((p) => p.category === category)) };
  }, options);
}

/** The public URL prefix every admin upload lives under, e.g. "https://pub-x.r2.dev/admin/uploads/". */
export function adminUploadsBase(publicBase = r2Config().publicBase) {
  const base = (publicBase || '').replace(/\/+$/, '');
  return base ? `${base}/${UPLOADS_PREFIX}` : '';
}

/**
 * The R2 key for an admin upload URL, or null if the URL is not one of ours.
 * Matches on the full "<base>/admin/uploads/" boundary, so a look-alike host
 * ("https://pub-x.r2.dev.evil.test/...") never matches, and rejects traversal.
 */
export function adminUploadKeyFromUrl(url, publicBase = r2Config().publicBase) {
  const uploadsBase = adminUploadsBase(publicBase);
  if (!uploadsBase || typeof url !== 'string' || !url.startsWith(uploadsBase)) return null;
  let key;
  try {
    key = decodeURIComponent(url.slice(uploadsBase.length - UPLOADS_PREFIX.length));
  } catch {
    return null;
  }
  if (!key.startsWith(UPLOADS_PREFIX) || key.length === UPLOADS_PREFIX.length) return null;
  if (key.includes('..') || /[?#\\]/.test(key)) return null;
  return key;
}

/** Best-effort delete of an admin-uploaded R2 object by its public URL. */
export async function deleteObjectByUrl(url, options = {}) {
  const { config, client } = deps(options);
  const key = adminUploadKeyFromUrl(url, config.publicBase);
  if (!key) return; // only ever remove admin uploads
  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (err) {
    console.error('[posts] object delete failed:', err?.name || err);
  }
}

/** Published posts for a given category. */
export async function postsForCategory(categorySlug) {
  const posts = await readPosts();
  return posts.filter((p) => p.published !== false && p.category === categorySlug);
}

/** A single published post by category + slug (for its detail page). */
export async function getPost(categorySlug, slug) {
  const posts = await readPosts();
  return posts.find((p) => p.category === categorySlug && p.slug === slug && p.published !== false) || null;
}

/**
 * Shape an admin post into the same item structure the catalog uses, so the
 * existing ItemCard / detail components render it unchanged. Adds caption,
 * hashtags, createdAt, and the source flag.
 */
export function postToItem(post) {
  return {
    slug: post.slug,
    title: post.title,
    thumbnail: post.type === 'image' ? post.url : null,
    types: [post.type],
    group: post.group || 'other',
    files: [{ name: post.fileName, label: 'Download', url: post.url, type: post.type, ext: extOf(post.fileName) }],
    caption: post.caption || '',
    hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
    createdAt: post.createdAt,
    source: 'admin',
  };
}

function extOf(name = '') {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}
