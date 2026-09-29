import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { isAuthed } from '@/lib/adminAuth';
import { isSameOrigin } from '@/lib/rateLimit';
import {
  readPostsStrict,
  addPost,
  updatePost,
  reorderPosts,
  deletePost,
  deleteObjectByUrl,
  adminUploadKeyFromUrl,
  sortForDisplay,
  PostsStoreError,
} from '@/lib/posts';
import { POST_LIMITS, clip, normalizeHashtags, normalizePostPatch, normalizeReorder } from '@/lib/postPatch';
import { getCategory } from '@/lib/catalog';

export const runtime = 'nodejs';

const isValidCategory = (slug) => Boolean(getCategory(slug));

// Purge the cached pages a post affects so changes appear immediately.
function revalidateForPost(post) {
  revalidatePath(`/category/${post.category}`);
  revalidatePath(`/category/${post.category}/${post.slug}`);
  revalidatePath('/browse');
  revalidatePath('/whats-new');
  revalidatePath('/');
}

const unauthorized = () => NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
const forbidden = () => NextResponse.json({ ok: false, error: 'forbidden_origin' }, { status: 403 });
const badRequest = (error, extra = {}) => NextResponse.json({ ok: false, error, ...extra }, { status: 400 });

/** Every write needs the admin cookie AND a same-origin request. */
function guardWrite(request) {
  if (!isAuthed(request.cookies)) return unauthorized();
  if (!isSameOrigin(request)) return forbidden();
  return null;
}

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Storage failures are ours, not the admin's input: answer 503 with a readable
// message, and never pretend a failed read was an empty list.
function storeFailure(err, action) {
  console.error(`[admin/posts] ${action} failed:`, err?.code || err?.name || err);
  const busy = err instanceof PostsStoreError && err.code === 'write_contention';
  return NextResponse.json(
    {
      ok: false,
      error: `${action}_failed`,
      message: busy
        ? 'Someone else is saving right now. Please try again in a moment.'
        : 'Content storage is unavailable right now. Nothing was changed — please try again.',
    },
    { status: 503 }
  );
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

// GET — list all posts (admin dashboard), in display order.
export async function GET(request) {
  if (!isAuthed(request.cookies)) return unauthorized();
  try {
    const { posts } = await readPostsStrict();
    return NextResponse.json({ ok: true, posts: sortForDisplay(posts) });
  } catch (err) {
    return storeFailure(err, 'list');
  }
}

// POST — create a post.
export async function POST(request) {
  const denied = guardWrite(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest('invalid_json');

  const title = clip(body.title, POST_LIMITS.title);
  const category = clip(body.category, 80);
  const url = clip(body.url, 2000);
  const type = ['image', 'video', 'pdf'].includes(body.type) ? body.type : 'file';
  const fileName = clip(body.fileName, 200);

  if (!title) return badRequest('missing_title');
  if (!isValidCategory(category)) return badRequest('invalid_category');
  if (!url) return badRequest('missing_file');
  // Only files uploaded through /api/admin/upload-url may be published — never an
  // arbitrary external link rendered as a download to every loan officer.
  if (!adminUploadKeyFromUrl(url)) return badRequest('invalid_file_url');

  const id = randomUUID();
  const post = {
    id,
    title,
    slug: `${slugify(title) || 'post'}-${id.slice(0, 6)}`,
    category,
    group: clip(body.group, POST_LIMITS.group) || null,
    url,
    type,
    fileName: fileName || title,
    caption: clip(body.caption, POST_LIMITS.caption),
    hashtags: normalizeHashtags(body.hashtags),
    createdAt: new Date().toISOString(),
    published: body.published !== false,
  };

  try {
    await addPost(post);
  } catch (err) {
    return storeFailure(err, 'save');
  }
  revalidateForPost(post);
  return NextResponse.json({ ok: true, post });
}

/**
 * PATCH — two shapes:
 *   ?id=<id>  { title?, category?, group?, caption?, hashtags?, published? }  edit one piece
 *   (no id)   { reorder: { category, ids: [...] } }                           set a category's order
 * The slug never changes, so existing links to a piece keep working after an edit.
 */
export async function PATCH(request) {
  const denied = guardWrite(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest('invalid_json');

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return reorder(body);

  const parsed = normalizePostPatch(body, { isValidCategory });
  if (!parsed.ok) return badRequest(parsed.error, parsed.field ? { field: parsed.field } : {});

  let result;
  try {
    result = await updatePost(id, parsed.patch);
  } catch (err) {
    return storeFailure(err, 'save');
  }
  if (!result) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  revalidateForPost(result.before);
  if (result.after.category !== result.before.category) revalidateForPost(result.after);
  return NextResponse.json({ ok: true, post: result.after });
}

async function reorder(body) {
  const order = normalizeReorder(body.reorder, { isValidCategory });
  if (!order.ok) return badRequest(order.error);
  try {
    const posts = await reorderPosts(order.category, order.ids);
    posts.forEach(revalidateForPost);
    return NextResponse.json({ ok: true, posts });
  } catch (err) {
    if (err instanceof PostsStoreError && err.code === 'invalid_order') {
      return NextResponse.json(
        { ok: false, error: 'stale_order', message: 'The list changed since you loaded it. Refresh and try again.' },
        { status: 409 }
      );
    }
    return storeFailure(err, 'reorder');
  }
}

// DELETE — remove a post by ?id=.
export async function DELETE(request) {
  const denied = guardWrite(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return badRequest('missing_id');

  let removed;
  try {
    removed = await deletePost(id);
  } catch (err) {
    return storeFailure(err, 'delete');
  }
  if (!removed) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  await deleteObjectByUrl(removed.url);
  revalidateForPost(removed);
  return NextResponse.json({ ok: true });
}
