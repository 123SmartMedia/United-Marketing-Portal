'use client';

import { useRef, useState } from 'react';

/** Wraps content with a copy-to-clipboard button (for captions / hashtags). */
export default function CopyBlock({ text, children }) {
  const [status, setStatus] = useState('idle'); // idle | copied | blocked
  const contentRef = useRef(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
      setTimeout(() => setStatus('idle'), 1800);
    } catch {
      // Clipboard blocked: select the text so Ctrl+C / long-press works, and say so.
      const selection = window.getSelection();
      if (contentRef.current && selection) {
        const range = document.createRange();
        range.selectNodeContents(contentRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setStatus('blocked');
    }
  }

  const copied = status === 'copied';
  let announcement = '';
  if (copied) announcement = 'Copied to clipboard.';
  else if (status === 'blocked') announcement = 'Copy was blocked. The text is selected; press Control C to copy.';

  return (
    <div className="relative rounded-xl border border-navy-100 bg-white p-4 pr-24">
      <div ref={contentRef}>{children}</div>
      <button
        type="button"
        onClick={copy}
        className={`absolute right-3 top-3 min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          copied ? 'bg-emerald-600 text-white' : 'bg-navy-100 text-navy-700 hover:bg-brand-600 hover:text-white'
        }`}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
      {status === 'blocked' && (
        <p className="mt-2 text-xs font-medium text-navy-700">Text selected — press Ctrl+C (⌘C on Mac) to copy.</p>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
