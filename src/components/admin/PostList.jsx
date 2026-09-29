'use client';

import { useState } from 'react';
import { isNew } from '@/lib/groups';
import EditPostDialog from './EditPostDialog';

/**
 * Admin list of added pieces, grouped by category in display order. Each piece
 * can be edited, published/unpublished, moved up/down within its category, or
 * deleted. Every failure is shown — nothing fails silently.
 */
export default function PostList({ posts, categories, groupOptions, onPostChanged, onPostRemoved, onCategoryReordered }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const q = query.trim().toLowerCase();
  const visible = q
    ? posts.filter((p) => `${p.title} ${p.caption || ''} ${(p.hashtags || []).join(' ')}`.toLowerCase().includes(q))
    : posts;
  const titleOf = (slug) => categories.find((c) => c.slug === slug)?.title || slug;
  const groups = categories
    .map((c) => ({ ...c, items: visible.filter((p) => p.category === c.slug) }))
    .filter((g) => g.items.length);

  async function run(id, fn) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusyId('');
    }
  }

  async function send(url, init, fallback) {
    let res;
    try {
      res = await fetch(url, init);
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.message || fallback);
    return json;
  }

  const togglePublished = (p) =>
    run(p.id, async () => {
      const live = p.published === false;
      const json = await send(
        `/api/admin/posts?id=${encodeURIComponent(p.id)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published: live }) },
        `Could not ${live ? 'publish' : 'unpublish'} “${p.title}”.`
      );
      onPostChanged(json.post);
      setNotice(`“${p.title}” is now ${live ? 'live' : 'a draft'}.`);
    });

  const move = (p, delta) =>
    run(p.id, async () => {
      const ids = posts.filter((x) => x.category === p.category).map((x) => x.id);
      const from = ids.indexOf(p.id);
      const to = from + delta;
      if (to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      const json = await send(
        '/api/admin/posts',
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reorder: { category: p.category, ids } }) },
        `Could not move “${p.title}”.`
      );
      onCategoryReordered(p.category, json.posts);
      setNotice(`Moved “${p.title}” ${delta < 0 ? 'up' : 'down'}.`);
    });

  const remove = (p) => {
    if (!confirm(`Delete “${p.title}”? This removes it from the site.`)) return;
    run(p.id, async () => {
      await send(`/api/admin/posts?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' }, `Could not delete “${p.title}”.`);
      onPostRemoved(p.id);
      setNotice(`Deleted “${p.title}”.`);
    });
  };

  const iconBtn =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-navy-500 transition hover:bg-navy-50 hover:text-navy-900 disabled:cursor-not-allowed disabled:opacity-30';

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">Added pieces ({posts.length})</h2>

      <label htmlFor="admin-filter" className="sr-only">Filter added pieces</label>
      <input
        id="admin-filter"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by title, caption or hashtag…"
        className="mb-3 h-11 w-full rounded-xl border border-navy-200 px-4 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
      />
      {q && <p className="mb-3 text-xs text-navy-500">Clear the filter to reorder pieces.</p>}

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      <p aria-live="polite" className="sr-only">{notice}</p>

      {posts.length === 0 && (
        <p className="rounded-xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-500">Nothing added yet.</p>
      )}
      {posts.length > 0 && groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-500">No pieces match “{query}”.</p>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.slug} aria-labelledby={`admin-cat-${g.slug}`}>
            <h3 id={`admin-cat-${g.slug}`} className="mb-2 text-sm font-semibold text-navy-800">
              {titleOf(g.slug)} <span className="font-normal text-navy-500">({g.items.length})</span>
            </h3>
            <ul className="space-y-2">
              {g.items.map((p, index) => {
                const draft = p.published === false;
                const busy = busyId === p.id;
                return (
                  <li key={p.id} className={`rounded-xl border bg-white p-2.5 ${draft ? 'border-dashed border-navy-300' : 'border-navy-100'}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-navy-50 text-[10px] font-semibold text-navy-500">
                        {p.type === 'image' ? (
                          // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of an R2 upload; image optimization is off site-wide
                          <img src={p.url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          p.type.toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-navy-800">{p.title}</p>
                        <p className="flex flex-wrap items-center gap-1 text-xs">
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${draft ? 'bg-navy-100 text-navy-700' : 'bg-emerald-100 text-emerald-800'}`}>
                            {draft ? 'Draft' : 'Live'}
                          </span>
                          {isNew(p.createdAt) && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">NEW</span>}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-navy-50 pt-2">
                      <button type="button" className={iconBtn} disabled={busy || !!q || index === 0} onClick={() => move(p, -1)} aria-label={`Move “${p.title}” up`}>
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 12 5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                      <button type="button" className={iconBtn} disabled={busy || !!q || index === g.items.length - 1} onClick={() => move(p, 1)} aria-label={`Move “${p.title}” down`}>
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                      <button type="button" disabled={busy} onClick={() => setEditing(p)} className="h-11 rounded-lg px-3 text-sm font-medium text-brand-700 hover:bg-brand-50" aria-label={`Edit “${p.title}”`}>
                        Edit
                      </button>
                      <button type="button" disabled={busy} onClick={() => togglePublished(p)} className="h-11 rounded-lg px-3 text-sm font-medium text-navy-700 hover:bg-navy-50" aria-label={`${draft ? 'Publish' : 'Unpublish'} “${p.title}”`}>
                        {draft ? 'Publish' : 'Unpublish'}
                      </button>
                      <button type="button" disabled={busy} onClick={() => remove(p)} className={`${iconBtn} ml-auto hover:!bg-red-50 hover:!text-red-700`} aria-label={`Delete “${p.title}”`}>
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {editing && (
        <EditPostDialog
          key={editing.id}
          post={editing}
          categories={categories}
          groupOptions={groupOptions}
          onClose={() => setEditing(null)}
          onSaved={(post) => {
            onPostChanged(post);
            setNotice(`Saved “${post.title}”.`);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
