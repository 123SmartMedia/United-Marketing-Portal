'use client';

import { useRef, useState, useCallback } from 'react';
import {
  ACCEPTED_UPLOAD_TYPES,
  ACCEPTED_UPLOAD_EXT,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} from '@/lib/requestSchema';

/**
 * Drag-and-drop upload zone. Files go straight to R2 via a short-lived presigned
 * PUT URL (keeps large files off the 4.5MB serverless body limit); only the
 * resulting {name, url, size, type} metadata is stored in the form and emailed.
 *
 * Controlled: `value` is the files array, `onChange` replaces it.
 */
export default function FileDropzone({ value = [], onChange, error }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const totalBytes = value.reduce((n, f) => n + f.size, 0);

  const addFiles = useCallback(
    async (fileList) => {
      setLocalError('');
      const incoming = Array.from(fileList);
      if (!incoming.length) return;

      if (value.length + incoming.length > MAX_FILES) {
        setLocalError(`You can attach up to ${MAX_FILES} files.`);
        return;
      }
      for (const f of incoming) {
        if (!ACCEPTED_UPLOAD_TYPES.includes(f.type)) {
          setLocalError(`“${f.name}” isn’t a supported type. Use PDF, PNG, or JPG.`);
          return;
        }
      }
      const projected = totalBytes + incoming.reduce((n, f) => n + f.size, 0);
      if (projected > MAX_TOTAL_BYTES) {
        setLocalError(`Total upload size must stay under ${(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB.`);
        return;
      }

      setBusy(true);
      const uploaded = [];
      try {
        for (const file of incoming) {
          // 1) Ask the server for a presigned PUT URL.
          const presignRes = await fetch('/api/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
          });
          const presign = await presignRes.json();
          if (!presignRes.ok || !presign.uploadUrl) {
            throw new Error(presign.error || 'presign_failed');
          }
          // 2) Upload the bytes straight to R2.
          const putRes = await fetch(presign.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
          });
          if (!putRes.ok) throw new Error('upload_failed');
          uploaded.push({ name: file.name, url: presign.publicUrl, size: file.size, type: file.type });
        }
        onChange([...value, ...uploaded]);
      } catch (err) {
        setLocalError(
          err.message === 'uploads_not_configured'
            ? 'File uploads aren’t enabled yet. You can submit without files and email them to marketing@unitedmortgage.com.'
            : 'Upload failed. Please try again, or submit without files.'
        );
      } finally {
        setBusy(false);
      }
    },
    [value, onChange, totalBytes]
  );

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  function removeAt(i) {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  }

  const shownError = localError || error;

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-navy-800">
        Upload headshots, logos, or reference examples
      </span>
      <p className="mb-2 text-xs text-navy-400">PDF, PNG, or JPG · up to {MAX_FILES} files · 10MB total · optional</p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-navy-200 bg-navy-50/40 hover:border-brand-300'
        }`}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-brand-500" aria-hidden="true">
          <path d="M12 16V4m0 0 4 4m-4-4L8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-medium text-navy-700">
          {busy ? 'Uploading…' : 'Drag & drop files here, or tap to browse'}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_UPLOAD_EXT}
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {value.length > 0 && (
        <ul className="mt-3 space-y-2">
          {value.map((f, i) => (
            <li key={f.url} className="flex items-center gap-3 rounded-xl border border-navy-100 bg-white px-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-[10px] font-bold uppercase text-emerald-600">
                {(f.name.split('.').pop() || '?').slice(0, 4)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-navy-700">{f.name}</span>
              <span className="shrink-0 text-xs text-navy-400">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="shrink-0 rounded-md p-1 text-navy-400 hover:text-red-600"
                aria-label={`Remove ${f.name}`}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {shownError && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {shownError}
        </p>
      )}
    </div>
  );
}
