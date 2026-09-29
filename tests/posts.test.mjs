import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addPost,
  deletePost,
  readPosts,
  readPostsStrict,
  adminUploadKeyFromUrl,
  deleteObjectByUrl,
  PostsStoreError,
  updatePost,
  reorderPosts,
  sortForDisplay,
} from '../src/lib/posts.js';
import { normalizePostPatch, normalizeReorder } from '../src/lib/postPatch.js';

/**
 * Admin content storage (admin/posts.json in R2). The two failure modes guarded
 * here are the ones that silently lose content: a transient read error treated
 * as "no posts" and then written back, and two concurrent saves where the last
 * writer drops the other's change.
 */

const BASE = 'https://pub-abc.r2.dev';
const CONFIG = { bucket: 'assets', publicBase: BASE };

/** In-memory stand-in for R2 that honours If-Match / If-None-Match like the real thing. */
function fakeR2() {
  const objects = new Map();
  let version = 0;
  const client = {
    failNextRead: false,
    deleted: [],
    async send(command) {
      await new Promise((r) => setImmediate(r)); // let concurrent callers interleave
      const name = command.constructor.name;
      const { Key, Body, IfMatch, IfNoneMatch } = command.input;
      if (name === 'GetObjectCommand') {
        if (client.failNextRead) {
          client.failNextRead = false;
          throw Object.assign(new Error('boom'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } });
        }
        const obj = objects.get(Key);
        if (!obj) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { ETag: obj.etag, Body: { transformToString: async () => obj.body } };
      }
      if (name === 'DeleteObjectCommand') {
        client.deleted.push(Key);
        return {};
      }
      const current = objects.get(Key);
      if ((IfNoneMatch === '*' && current) || (IfMatch && current?.etag !== IfMatch)) {
        throw Object.assign(new Error('precondition'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
      }
      version += 1;
      objects.set(Key, { body: Body, etag: `"v${version}"` });
      return {};
    },
  };
  return { client, objects };
}

const post = (id, createdAt = '2026-09-01T00:00:00Z') => ({
  id,
  title: `Post ${id}`,
  slug: `post-${id}`,
  category: 'social-media',
  url: `${BASE}/admin/uploads/2026-09-01/${id}.png`,
  type: 'image',
  createdAt,
});

test('adds persist and read back newest first', async () => {
  const { client } = fakeR2();
  const opts = { client, config: CONFIG };
  await addPost(post('a', '2026-09-01T00:00:00Z'), opts);
  await addPost(post('b', '2026-09-02T00:00:00Z'), opts);
  assert.deepEqual((await readPosts(opts)).map((p) => p.id), ['b', 'a']);
});

test('a failed read never wipes existing posts', async () => {
  const { client } = fakeR2();
  const opts = { client, config: CONFIG };
  await addPost(post('a'), opts);
  await addPost(post('b'), opts);

  client.failNextRead = true;
  await assert.rejects(addPost(post('c'), opts), (err) => err instanceof PostsStoreError && err.code === 'read_failed');
  client.failNextRead = true;
  await assert.rejects(deletePost('a', opts), (err) => err.code === 'read_failed');

  assert.equal((await readPostsStrict(opts)).posts.length, 2);
});

test('public reads stay tolerant: a failure renders as no posts', async () => {
  const { client } = fakeR2();
  const opts = { client, config: CONFIG };
  await addPost(post('a'), opts);
  client.failNextRead = true;
  assert.deepEqual(await readPosts(opts), []);
});

test('a corrupt document is an error for writes, not an empty list', async () => {
  const { client, objects } = fakeR2();
  objects.set('admin/posts.json', { body: '{not json', etag: '"x"' });
  await assert.rejects(addPost(post('a'), { client, config: CONFIG }), (err) => err.code === 'corrupt_document');
  assert.equal(objects.get('admin/posts.json').body, '{not json');
});

test('concurrent adds both persist', async () => {
  const { client } = fakeR2();
  const opts = { client, config: CONFIG };
  await Promise.all([addPost(post('a'), opts), addPost(post('b'), opts), addPost(post('c'), opts)]);
  assert.deepEqual((await readPosts(opts)).map((p) => p.id).sort(), ['a', 'b', 'c']);
});

test('concurrent add and delete do not lose each other', async () => {
  const { client } = fakeR2();
  const opts = { client, config: CONFIG };
  await addPost(post('a'), opts);
  const [, removed] = await Promise.all([addPost(post('b'), opts), deletePost('a', opts)]);
  assert.equal(removed.id, 'a');
  assert.deepEqual((await readPosts(opts)).map((p) => p.id), ['b']);
});

test('deletePost returns null for an unknown id without writing', async () => {
  const { client, objects } = fakeR2();
  const opts = { client, config: CONFIG };
  await addPost(post('a'), opts);
  const etag = objects.get('admin/posts.json').etag;
  assert.equal(await deletePost('zzz', opts), null);
  assert.equal(objects.get('admin/posts.json').etag, etag);
});

test('adminUploadKeyFromUrl only accepts our own admin uploads', () => {
  assert.equal(adminUploadKeyFromUrl(`${BASE}/admin/uploads/2026/x.png`, BASE), 'admin/uploads/2026/x.png');
  assert.equal(adminUploadKeyFromUrl(`${BASE}/admin/uploads/2026/a%20b.png`, `${BASE}/`), 'admin/uploads/2026/a b.png');
  // Look-alike host, other prefixes, traversal, external links.
  assert.equal(adminUploadKeyFromUrl('https://pub-abc.r2.dev.evil.test/admin/uploads/x.png', BASE), null);
  assert.equal(adminUploadKeyFromUrl(`${BASE}evil/admin/uploads/x.png`, BASE), null);
  assert.equal(adminUploadKeyFromUrl(`${BASE}/Program-Flyers/x.pdf`, BASE), null);
  assert.equal(adminUploadKeyFromUrl(`${BASE}/admin/uploads/../posts.json`, BASE), null);
  assert.equal(adminUploadKeyFromUrl(`${BASE}/admin/uploads/%2e%2e/posts.json`, BASE), null);
  assert.equal(adminUploadKeyFromUrl(`${BASE}/admin/uploads/`, BASE), null);
  assert.equal(adminUploadKeyFromUrl('https://example.com/x.png', BASE), null);
  assert.equal(adminUploadKeyFromUrl(`${BASE}/admin/uploads/x.png`, ''), null);
});

test('deleteObjectByUrl never deletes outside admin/uploads', async () => {
  const { client } = fakeR2();
  const opts = { client, config: CONFIG };
  await deleteObjectByUrl(`${BASE}/Program-Flyers/x.pdf`, opts);
  await deleteObjectByUrl('https://pub-abc.r2.dev.evil.test/admin/uploads/x.png', opts);
  await deleteObjectByUrl(`${BASE}/admin/uploads/2026/x.png`, opts);
  assert.deepEqual(client.deleted, ['admin/uploads/2026/x.png']);
});

// ---------------------------------------------------------------- edit / order

/** Count PutObject calls so "one write" claims are checked, not assumed. */
function countWrites(client) {
  const send = client.send.bind(client);
  client.writes = 0;
  client.send = (command) => {
    if (command.constructor.name === 'PutObjectCommand') client.writes += 1;
    return send(command);
  };
  return client;
}

test('updatePost only changes whitelisted fields', async () => {
  const { client } = fakeR2();
  const opts = { client, config: CONFIG };
  await addPost(post('a'), opts);
  const { before, after } = await updatePost(
    'a',
    { title: 'Renamed', published: false, url: 'https://evil.test/x.png', slug: 'hijack', id: 'zzz' },
    opts
  );
  assert.equal(before.title, 'Post a');
  assert.equal(after.title, 'Renamed');
  assert.equal(after.published, false);
  assert.equal(after.url, post('a').url);
  assert.equal(after.slug, 'post-a');
  assert.equal(after.id, 'a');
  assert.ok(after.updatedAt);
});

test('updatePost returns null for an unknown id without writing', async () => {
  const { client } = fakeR2();
  countWrites(client);
  const opts = { client, config: CONFIG };
  await addPost(post('a'), opts);
  client.writes = 0;
  assert.equal(await updatePost('missing', { title: 'x' }, opts), null);
  assert.equal(client.writes, 0);
});

test('moving a piece to another category drops its manual position', async () => {
  const { client } = fakeR2();
  const opts = { client, config: CONFIG };
  await addPost(post('a'), opts);
  await reorderPosts('social-media', ['a'], opts);
  const { after } = await updatePost('a', { category: 'program-flyers' }, opts);
  assert.equal(after.position, undefined);
});

test('concurrent edits to different pieces both persist', async () => {
  const { client } = fakeR2();
  const opts = { client, config: CONFIG };
  await addPost(post('a'), opts);
  await addPost(post('b'), opts);
  await Promise.all([updatePost('a', { title: 'A2' }, opts), updatePost('b', { title: 'B2' }, opts)]);
  const titles = (await readPostsStrict(opts)).posts.map((p) => p.title).sort();
  assert.deepEqual(titles, ['A2', 'B2']);
});

test('reorderPosts sets positions in ONE write and public reads follow it', async () => {
  const { client } = fakeR2();
  countWrites(client);
  const opts = { client, config: CONFIG };
  await addPost(post('a', '2026-09-01T00:00:00Z'), opts);
  await addPost(post('b', '2026-09-02T00:00:00Z'), opts);
  await addPost(post('c', '2026-09-03T00:00:00Z'), opts);
  client.writes = 0;
  const ordered = await reorderPosts('social-media', ['a', 'c', 'b'], opts);
  assert.equal(client.writes, 1);
  assert.deepEqual(ordered.map((p) => p.id), ['a', 'c', 'b']);
  assert.deepEqual((await readPosts(opts)).map((p) => p.id), ['a', 'c', 'b']);
});

test('reorderPosts refuses a stale or partial order without writing', async () => {
  const { client } = fakeR2();
  countWrites(client);
  const opts = { client, config: CONFIG };
  await addPost(post('a'), opts);
  await addPost(post('b'), opts);
  client.writes = 0;
  for (const ids of [['a'], ['a', 'b', 'x'], ['a', 'a']]) {
    await assert.rejects(reorderPosts('social-media', ids, opts), (err) => err.code === 'invalid_order');
  }
  assert.equal(client.writes, 0);
});

test('sortForDisplay: positioned pieces first, then newest first', () => {
  const list = [
    { id: 'old', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'p1', position: 1, createdAt: '2026-01-02T00:00:00Z' },
    { id: 'new', createdAt: '2026-03-01T00:00:00Z' },
    { id: 'p0', position: 0, createdAt: '2025-01-01T00:00:00Z' },
  ];
  assert.deepEqual(sortForDisplay(list).map((p) => p.id), ['p0', 'p1', 'new', 'old']);
});

test('normalizePostPatch validates and clips an edit', () => {
  const isValidCategory = (c) => c === 'social-media';
  const ok = normalizePostPatch(
    { title: '  Hello ', group: '', hashtags: ['#One', ' two ', ''], published: true },
    { isValidCategory }
  );
  assert.deepEqual(ok, { ok: true, patch: { title: 'Hello', group: null, hashtags: ['One', 'two'], published: true } });
  assert.equal(normalizePostPatch({ title: 'x'.repeat(500) }, { isValidCategory }).patch.title.length, 200);
  assert.equal(normalizePostPatch({ url: 'x' }, { isValidCategory }).error, 'unknown_field');
  assert.equal(normalizePostPatch({ hashtags: 'nope' }, { isValidCategory }).error, 'invalid_hashtags');
  assert.equal(normalizePostPatch(null, { isValidCategory }).error, 'invalid_body');
  assert.equal(normalizeReorder({ category: 'social-media', ids: ['a', 3] }, { isValidCategory }).error, 'invalid_order');
  assert.equal(normalizeReorder({ category: 'nope', ids: ['a'] }, { isValidCategory }).error, 'invalid_category');
});
