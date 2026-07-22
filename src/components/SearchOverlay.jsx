'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getAllItems } from '@/lib/catalog';
import { assetUrl } from '@/lib/asset';

/**
 * Instant client-side search across the whole catalog — replaces the WordPress
 * header search plugin with zero-latency filtering over the structured content.
 */
export default function SearchOverlay({ open, onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  const items = useMemo(() => getAllItems(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/);
    return items
      .map((item) => {
        const haystack = `${item.title} ${item.categoryTitle}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (!haystack.includes(t)) return null;
          if (item.title.toLowerCase().startsWith(t)) score += 2;
          score += 1;
        }
        return { item, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)
      .map((r) => r.item);
  }, [query, items]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-navy-950/40 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-navy-100 px-4">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="text-navy-400">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="m14 14 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search flyers, videos, social posts, business cards…"
            className="h-14 w-full bg-transparent text-navy-900 outline-none placeholder:text-navy-300"
          />
          <button onClick={onClose} className="text-xs font-medium text-navy-400 hover:text-navy-600">
            ESC
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {query.trim() && results.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-navy-400">
              No assets match “{query}”. Try a program name (VA, DSCR, ITIN) or type (flyer, video).
            </p>
          )}
          {results.map((item) => (
            <Link
              key={`${item.category}/${item.slug}`}
              href={`/category/${item.category}/${item.slug}`}
              onClick={onClose}
              className="flex items-center gap-3 border-b border-navy-50 px-4 py-3 transition hover:bg-navy-50"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-navy-50">
                {item.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(item.thumbnail)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <TypeGlyph types={item.types} />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-navy-900">{item.title}</p>
                <p className="truncate text-xs text-navy-400">
                  {item.categoryTitle} · {item.files.length} file{item.files.length > 1 ? 's' : ''}
                </p>
              </div>
            </Link>
          ))}
          {!query.trim() && (
            <p className="px-4 py-8 text-center text-sm text-navy-300">
              Start typing to search {getAllItems().length} marketing assets.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TypeGlyph({ types }) {
  const label = types.includes('video') ? '▶' : types.includes('pdf') ? 'PDF' : '★';
  return <span className="text-xs font-semibold text-navy-400">{label}</span>;
}
