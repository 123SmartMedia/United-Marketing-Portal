'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Edit one piece in a native modal <dialog>: the browser traps focus, Esc
 * closes it, and focus returns to the Edit button that opened it.
 */
export default function EditPostDialog({ post, categories, groupOptions, onSaved, onClose }) {
  const dialogRef = useRef(null);
  const [category, setCategory] = useState(post.category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const groups = groupOptions[category] || null;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const patch = {
      title: String(fd.get('title') || ''),
      category: String(fd.get('category') || ''),
      group: groups ? String(fd.get('group') || '') : '',
      caption: String(fd.get('caption') || ''),
      hashtags: String(fd.get('hashtags') || '')
        .split(/[\s,]+/)
        .map((h) => h.replace(/^#/, '').trim())
        .filter(Boolean),
      published: fd.get('published') === 'on',
    };
    if (!patch.title.trim()) {
      setError('Please enter a title.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/posts?id=${encodeURIComponent(post.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        onSaved(json.post);
        return;
      }
      setError(json.message || (res.status === 404 ? 'This piece no longer exists. Refresh the page.' : 'Could not save your changes. Please try again.'));
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  const label = 'mb-1.5 block text-sm font-medium text-navy-800';
  const input =
    'h-12 w-full rounded-xl border border-navy-200 px-4 text-[15px] focus:border-brand-500 focus:ring-2 focus:ring-brand-200';

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="edit-post-heading"
      className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-2xl p-0 backdrop:bg-navy-950/50"
    >
      <form onSubmit={onSubmit} className="space-y-4 p-6">
        <h2 id="edit-post-heading" className="text-lg font-bold text-navy-900">
          Edit “{post.title}”
        </h2>

        <div>
          <label htmlFor="edit-title" className={label}>
            Title <span className="text-brand-500">*</span>
          </label>
          <input id="edit-title" name="title" required defaultValue={post.title} className={input} autoFocus />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-category" className={label}>Category</label>
            <select id="edit-category" name="category" value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.title}</option>
              ))}
            </select>
          </div>
          {groups && (
            <div>
              <label htmlFor="edit-group" className={label}>Group</label>
              <select id="edit-group" name="group" defaultValue={post.category === category ? post.group || '' : ''} className={input}>
                <option value="">Auto / Other</option>
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>{g.title}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="edit-caption" className={label}>Suggested caption / content</label>
          <textarea
            id="edit-caption"
            name="caption"
            rows={4}
            defaultValue={post.caption || ''}
            className="w-full rounded-xl border border-navy-200 px-4 py-3 text-[15px] focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </div>

        <div>
          <label htmlFor="edit-hashtags" className={label}>Hashtags</label>
          <input
            id="edit-hashtags"
            name="hashtags"
            defaultValue={(post.hashtags || []).map((h) => `#${h}`).join(' ')}
            className={input}
          />
        </div>

        <label htmlFor="edit-published" className="flex cursor-pointer items-center gap-3 text-sm text-navy-800">
          <input id="edit-published" name="published" type="checkbox" defaultChecked={post.published !== false} className="h-5 w-5 rounded border-navy-300" />
          Live on the site (uncheck to keep it as a draft)
        </label>

        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="h-11 rounded-full border border-navy-200 px-5 text-sm font-medium text-navy-700 hover:border-brand-400"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 rounded-full bg-brand-600 px-6 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
