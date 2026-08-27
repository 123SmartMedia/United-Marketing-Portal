import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { isAuthed } from '@/lib/adminAuth';
import { readPosts, addPost, deletePost, deleteObjectByUrl } from '@/lib/posts';
import { getCategory } from '@/lib/catalog';

// Purge the cached pages a post affects so it appears/disappears immediately.
function revalidateForPost(post) {
  revalidatePath(`/category/${post.category}`);
  revalidatePath(`/category/${post.category}/${post.slug}`);
  revalidatePath('/browse');
}

export const runtime = 'nodejs';

const MAX = { title: 200, caption: 3000, hashtag: 60, hashtags: 40 };

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function clip(v, n) {
  return typeof v === 'string' ? v.trim().slice(0, n) : '';
}

// GET — list all posts (admin dashboard).
export async function GET(request) {
  if (!isAuthed(request.cookies)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, posts: await readPosts() });
}

// POST — create a post.
export async function POST(request) {
  if (!isAuthed(request.cookies)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const title = clip(body.title, MAX.title);
  const category = clip(body.category, 80);
  const url = clip(body.url, 2000);
  const type = ['image', 'video', 'pdf'].includes(body.type) ? body.type : 'file';
  const fileName = clip(body.fileName, 200);

  if (!title) return NextResponse.json({ ok: false, error: 'missing_title' }, { status: 400 });
  if (!getCategory(category)) return NextResponse.json({ ok: false, error: 'invalid_category' }, { status: 400 });
  if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ ok: false, error: 'missing_file' }, { status: 400 });

  const hashtags = Array.isArray(body.hashtags)
    ? body.hashtags
        .map((h) => clip(h, MAX.hashtag).replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, MAX.hashtags)
    : [];

  const id = randomUUID();
  const post = {
    id,
    title,
    slug: `${slugify(title) || 'post'}-${id.slice(0, 6)}`,
    category,
    group: clip(body.group, 40) || null,
    url,
    type,
    fileName: fileName || title,
    caption: clip(body.caption, MAX.caption),
    hashtags,
    createdAt: new Date().toISOString(),
    published: true,
  };

  try {
    await addPost(post);
    revalidateForPost(post);
  } catch (err) {
    console.error('[admin/posts] save failed:', err);
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, post });
}

// DELETE — remove a post by ?id=.
export async function DELETE(request) {
  if (!isAuthed(request.cookies)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });
  try {
    const existing = (await readPosts()).find((p) => p.id === id);
    const removed = await deletePost(id);
    if (existing) {
      await deleteObjectByUrl(existing.url);
      revalidateForPost(existing);
    }
    return NextResponse.json({ ok: removed });
  } catch (err) {
    console.error('[admin/posts] delete failed:', err);
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }
}
