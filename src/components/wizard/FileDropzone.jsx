'use client';

import { useRef, useState, useCallback } from 'react';
import {
  ACCEPTED_UPLOAD_EXT,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  MAX_FILE_BYTES,
  validateFileMetadata,
  messageForUploadError,
} from '@/lib/uploadRules';

/**
 * Drag-and-drop upload zone.
 *
 * Nothing is uploaded here. Selecting a file only validates it and holds the
 * browser's File object in form state; the bytes are not sent anywhere until the
 * user actually submits and `/api/jira/requests/init` has redeemed a Turnstile
 * token and handed back a presigned PUT.
 *
 * That ordering is the point. Uploading on selection meant a bot that never
 * submitted the form could still write to the bucket, because the bot check ran
 * at submission time — after the bytes had landed.
 *
 * Each entry is { name, size, type, file }. `file` is the live File object and
 * never leaves the browser as JSON; only name/size/type are sent to the server.
 * No readable URL and no object key exists on the client until init returns one.
 *
 * Controlled: `value` is the files array, `onChange` replaces it.
 */
export default function FileDropzone({ value = [], onChange, error }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState('');

  const totalBytes = value.reduce((n, f) => n + f.size, 0);

  const addFiles = useCallback(
    (fileList) => {
      setLocalError('');
      const incoming = Array.from(fileList);
      if (!incoming.length) return;

      if (value.length + incoming.length > MAX_FILES) {
        setLocalError(`You can attach up to ${MAX_FILES} files.`);
        return;
      }

      // Same rules the server enforces — both read src/lib/uploadRules.js, so the
      // browser can never be more permissive than /init and /finalize.
      const accepted = [];
      let projected = totalBytes;
      for (const file of incoming) {
        const check = validateFileMetadata({ name: file.name, size: file.size, type: file.type });
        if (!check.ok) {
          setLocalError(messageForUploadError(check.error, check.fileName));
          return;
        }
        projected += file.size;
        if (projected > MAX_TOTAL_BYTES) {
          setLocalError(`Total upload size must stay under ${(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB.`);
          return;
        }
        accepted.push({ name: check.file.name, size: check.file.size, type: check.file.type, file });
      }

      onChange([...value, ...accepted]);
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
      <p className="mb-2 text-xs text-navy-400">
        PDF, PNG, or JPG · up to {MAX_FILES} files · {(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB total · optional
        — files are sent when you submit
      </p>

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
          Drag &amp; drop files here, or tap to browse
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
            <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-3 rounded-xl border border-navy-100 bg-white px-3 py-2">
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
