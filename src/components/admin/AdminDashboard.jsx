'use client';

import { useRef, useState } from 'react';
import { isNew } from '@/lib/groups';

export default function AdminDashboard({ categories, groupOptions, initialPosts }) {
  const [posts, setPosts] = useState(initialPosts || []);

  function onAdded(post) {
    setPosts((p) => [post, ...p]);
  }
  async function onDelete(id) {
    if (!confirm('Delete this piece? This removes it from the site.')) return;
    const res = await fetch(`/api/admin/posts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) setPosts((p) => p.filter((x) => x.id !== id));
  }
  async function logout() {
    await fetch('/api/admin/login', { method: 'DELETE' });
    window.location.href = '/';
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Content admin</h1>
          <p className="mt-1 text-sm text-navy-500">Add new pieces with suggested captions and hashtags.</p>
        </div>
        <button onClick={logout} className="rounded-full border border-navy-200 px-4 py-2 text-sm font-medium text-navy-600 hover:border-brand-400">
          Sign out
        </button>
      </div>

      <div className="grid gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <AddPostForm categories={categories} groupOptions={groupOptions} onAdded={onAdded} />
        </div>
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-400">
            Added pieces ({posts.length})
          </h2>
          <ul className="space-y-2">
            {posts.length === 0 && <li className="rounded-xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-400">Nothing added yet.</li>}
            {posts.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-navy-100 bg-white p-2.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-navy-50 text-[10px] font-semibold text-navy-400">
                  {p.type === 'image' ? <img src={p.url} alt="" className="h-full w-full object-cover" /> : p.type.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy-800">{p.title}</p>
                  <p className="truncate text-xs text-navy-400">
                    {p.category}{isNew(p.createdAt) && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700">NEW</span>}
                  </p>
                </div>
                <button onClick={() => onDelete(p.id)} className="shrink-0 rounded-md p-1.5 text-navy-400 hover:text-red-600" aria-label="Delete">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function AddPostForm({ categories, groupOptions, onAdded }) {
  const inputRef = useRef(null);
  const [upload, setUpload] = useState(null); // { url, type, fileName }
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  const groups = groupOptions[category] || null;

  async function handleFile(file) {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const presignRes = await fetch('/api/admin/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok || !presign.uploadUrl) throw new Error(presign.error || 'presign_failed');
      const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error('upload_failed');
      setUpload({ url: presign.publicUrl, type: presign.kind, fileName: file.name });
    } catch (err) {
      setError(err.message === 'unsupported_type' ? 'Unsupported file type (use PNG, JPG, PDF, or MP4).' : 'Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!upload) { setError('Please upload a file first.'); return; }
    const fd = new FormData(e.currentTarget);
    const hashtags = String(fd.get('hashtags') || '')
      .split(/[\s,]+/).map((h) => h.replace(/^#/, '').trim()).filter(Boolean);

    setStatus('submitting');
    try {
      const res = await fetch('/api/admin/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: fd.get('title'),
          category: fd.get('category'),
          group: fd.get('group') || null,
          caption: fd.get('caption'),
          hashtags,
          url: upload.url,
          type: upload.type,
          fileName: upload.fileName,
        }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        onAdded(json.post);
        e.target.reset();
        setUpload(null);
        setCategory('');
        setStatus('success');
        setTimeout(() => setStatus('idle'), 2500);
      } else {
        setStatus('idle');
        setError('Could not save. Please check the fields and try again.');
      }
    } catch {
      setStatus('idle');
      setError('Something went wrong. Please try again.');
    }
  }

  const label = 'mb-1.5 block text-sm font-medium text-navy-800';
  const input = 'h-12 w-full rounded-xl border border-navy-200 px-4 text-[15px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200';

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      {/* Upload */}
      <div>
        <span className={label}>File</span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-navy-200 bg-navy-50/40 px-6 py-6 text-center transition hover:border-brand-300"
        >
          {upload ? (
            upload.type === 'image'
              ? <img src={upload.url} alt="" className="max-h-32 rounded-lg object-contain" />
              : <span className="text-sm font-medium text-navy-700">{upload.fileName} ({upload.type})</span>
          ) : (
            <span className="text-sm font-medium text-navy-700">{uploading ? 'Uploading…' : 'Tap to upload image, video, or PDF'}</span>
          )}
        </button>
        <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.pdf,.mp4,.mov" className="hidden"
          onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
        {upload && <button type="button" onClick={() => setUpload(null)} className="mt-1.5 text-xs text-navy-400 hover:text-red-600">Remove file</button>}
      </div>

      <div>
        <label htmlFor="title" className={label}>Title <span className="text-brand-500">*</span></label>
        <input id="title" name="title" required className={input} placeholder="e.g., Labor Day Holiday Post" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="category" className={label}>Category <span className="text-brand-500">*</span></label>
          <select id="category" name="category" required value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
            <option value="" disabled>Select…</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
          </select>
        </div>
        {groups && (
          <div>
            <label htmlFor="group" className={label}>Group</label>
            <select id="group" name="group" defaultValue="" className={input}>
              <option value="">Auto / Other</option>
              {groups.map((g) => <option key={g.key} value={g.key}>{g.title}</option>)}
            </select>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="caption" className={label}>Suggested caption / content</label>
        <textarea id="caption" name="caption" rows={4} className="w-full rounded-xl border border-navy-200 px-4 py-3 text-[15px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          placeholder="Suggested post copy the LO can paste when sharing this piece…" />
      </div>

      <div>
        <label htmlFor="hashtags" className={label}>Hashtags</label>
        <input id="hashtags" name="hashtags" className={input} placeholder="#UnitedMortgage #FirstTimeBuyer  (space or comma separated)" />
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={status === 'submitting' || uploading}
        className="w-full rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60">
        {status === 'submitting' ? 'Publishing…' : status === 'success' ? 'Published ✓' : 'Publish to site'}
      </button>
      <p className="text-center text-xs text-navy-400">New pieces are highlighted as “Just Added” for 10 days.</p>
    </form>
  );
}
