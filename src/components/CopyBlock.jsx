'use client';

import { useState } from 'react';

/** Wraps content with a copy-to-clipboard button (for captions / hashtags). */
export default function CopyBlock({ text, children }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — no-op; the text is still visible to select manually.
    }
  }

  return (
    <div className="relative rounded-xl border border-navy-100 bg-white p-4 pr-24">
      {children}
      <button
        type="button"
        onClick={copy}
        className={`absolute right-3 top-3 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          copied ? 'bg-emerald-500 text-white' : 'bg-navy-100 text-navy-700 hover:bg-brand-500 hover:text-white'
        }`}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}
