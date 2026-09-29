'use client';

import { useRef, useState } from 'react';

export default function AddPostForm({ categories, groupOptions, onAdded }) {
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
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        onAdded(json.post);
        e.target.reset();
        setUpload(null);
        setCategory('');
        setStatus('success');
        setTimeout(() => setStatus('idle'), 2500);
      } else {
        setStatus('idle');
        setError(json.message || 'Could not save. Please check the fields and try again.');
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
              // eslint-disable-next-line @next/next/no-img-element -- preview of the just-uploaded R2 file; image optimization is off site-wide
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
