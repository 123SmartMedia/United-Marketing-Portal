'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sortForDisplay } from '@/lib/postPatch';
import AddPostForm from './AddPostForm';
import PostList from './PostList';

export default function AdminDashboard({ categories, groupOptions, initialPosts }) {
  const router = useRouter();
  // The admin list always mirrors the public display order.
  const [posts, setPosts] = useState(() => sortForDisplay(initialPosts || []));

  const onAdded = (post) => setPosts((list) => sortForDisplay([post, ...list]));
  const onPostChanged = (post) => setPosts((list) => sortForDisplay(list.map((p) => (p.id === post.id ? post : p))));
  const onPostRemoved = (id) => setPosts((list) => list.filter((p) => p.id !== id));
  const onCategoryReordered = (category, ordered) =>
    setPosts((list) => sortForDisplay([...list.filter((p) => p.category !== category), ...ordered]));

  async function logout() {
    await fetch('/api/admin/login', { method: 'DELETE' }).catch(() => null);
    router.push('/');
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Content admin</h1>
          <p className="mt-1 text-sm text-navy-500">Add, edit, order and publish pieces with suggested captions and hashtags.</p>
        </div>
        <button onClick={logout} className="h-11 rounded-full border border-navy-200 px-4 text-sm font-medium text-navy-600 hover:border-brand-400">
          Sign out
        </button>
      </div>

      <div className="grid gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <AddPostForm categories={categories} groupOptions={groupOptions} onAdded={onAdded} />
        </div>
        <div className="lg:col-span-2">
          <PostList
            posts={posts}
            categories={categories}
            groupOptions={groupOptions}
            onPostChanged={onPostChanged}
            onPostRemoved={onPostRemoved}
            onCategoryReordered={onCategoryReordered}
          />
        </div>
      </div>
    </div>
  );
}
