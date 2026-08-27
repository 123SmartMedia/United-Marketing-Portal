import 'server-only';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Admin-added pieces (posts) live as a single JSON document in R2 at
 * admin/posts.json. Read server-side via the S3 API (not the cached public URL,
 * so edits appear promptly), written by the authenticated admin routes.
 *
 * Post shape:
 *   { id, title, slug, category, group|null, url, type, fileName,
 *     caption, hashtags[], createdAt, published }
 */

const POSTS_KEY = 'admin/posts.json';

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

function client() {
  const c = r2Config();
  return new S3Client({
    region: 'auto',
    endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
}

async function streamToString(body) {
  if (typeof body.transformToString === 'function') return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

/** Read all admin posts (newest first). Returns [] if none / not configured. */
export async function readPosts() {
  if (!isR2Configured()) return [];
  const { bucket } = r2Config();
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: POSTS_KEY }));
    const text = await streamToString(res.Body);
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [];
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (err) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return [];
    console.error('[posts] read failed:', err?.name || err);
    return [];
  }
}

/** Overwrite the whole posts document. */
export async function writePosts(posts) {
  const { bucket } = r2Config();
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: POSTS_KEY,
      Body: JSON.stringify(posts, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-store',
    })
  );
}

export async function addPost(post) {
  const posts = await readPosts();
  posts.unshift(post);
  await writePosts(posts);
  return post;
}

export async function deletePost(id) {
  const posts = await readPosts();
  const next = posts.filter((p) => p.id !== id);
  await writePosts(next);
  return posts.length !== next.length;
}

/** Best-effort delete of an admin-uploaded R2 object by its public URL. */
export async function deleteObjectByUrl(url) {
  const { bucket, publicBase } = r2Config();
  if (!url || !publicBase || !url.startsWith(publicBase)) return;
  const key = decodeURIComponent(url.slice(publicBase.replace(/\/+$/, '').length + 1));
  if (!key.startsWith('admin/uploads/')) return; // only ever remove admin uploads
  try {
    await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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
