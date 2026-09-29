'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAllItems } from '@/lib/catalog';
import { assetUrl } from '@/lib/asset';
import { indexItems, searchItems } from '@/lib/search';

/**
 * Instant client-side search across the catalog plus admin-added pieces.
 *
 * Accessibility: a modal dialog (focus trapped, focus restored on close,
 * Escape / backdrop close) containing a combobox — the input keeps focus while
 * ↑/↓ move through the listbox of results and Enter opens the active one. The
 * result count is announced through a polite live region.
 */

const INITIAL_LIMIT = 24;
const catalogIndex = indexItems(getAllItems());

export default function SearchOverlay({ open, onClose }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [postIndex, setPostIndex] = useState([]);
  const postsRequested = useRef(false);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const returnFocusRef = useRef(null);
  const titleId = useId();
  const listId = useId();
  const statusId = useId();

  // Admin-added pieces live outside the static catalog; fetch them once.
  useEffect(() => {
    if (!open || postsRequested.current) return;
    postsRequested.current = true;
    fetch('/api/search/posts')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((json) => setPostIndex(indexItems(Array.isArray(json.items) ? json.items : [])))
      .catch(() => {
        postsRequested.current = false; // try again next time the dialog opens
      });
  }, [open]);

  const allItems = useMemo(() => [...postIndex, ...catalogIndex], [postIndex]);
  const results = useMemo(() => searchItems(allItems, query), [allItems, query]);
  const visible = showAll ? results : results.slice(0, INITIAL_LIMIT);

  useEffect(() => {
    setActive(0);
    setShowAll(false);
  }, [query]);

  // Open: remember the trigger, reset, lock scroll, focus the input.
  // Close: unlock scroll and return focus to whatever opened the dialog.
  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    setQuery('');
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  const go = useCallback(
    (item) => {
      onClose();
      router.push(`/category/${item.category}/${item.slug}`);
    },
    [onClose, router]
  );

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      trapFocus(e, dialogRef.current);
      return;
    }
    if (e.target !== inputRef.current || !visible.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % visible.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + visible.length) % visible.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(visible[active]);
    }
  }

  if (!open) return null;

  const q = query.trim();
  let status = '';
  if (q) {
    status = results.length
      ? `${results.length} result${results.length === 1 ? '' : 's'}. Use the up and down arrows to choose, Enter to open.`
      : 'No results.';
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-navy-950/40 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <h2 id={titleId} className="sr-only">
          Search marketing assets
        </h2>
        <div className="flex items-center gap-3 border-b border-navy-100 px-4">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="shrink-0 text-navy-500" aria-hidden="true">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="m14 14 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search flyers, videos, social posts, business cards…"
            aria-label="Search marketing assets"
            role="combobox"
            aria-expanded={visible.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={visible.length ? `${listId}-${active}` : undefined}
            aria-describedby={statusId}
            className="h-14 w-full bg-transparent text-navy-900 outline-none placeholder:text-navy-500"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded px-1.5 py-1 text-xs font-medium text-navy-500 hover:text-navy-700"
          >
            ESC
          </button>
        </div>

        <p id={statusId} aria-live="polite" className="sr-only">
          {status}
        </p>

        <div className="max-h-[55vh] overflow-y-auto">
          {q && results.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-navy-600">
              No assets match “{query}”. Try a program name (VA, DSCR, ITIN), a type (flyer, video) or
              “Spanish”.
            </p>
          )}

          {visible.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Search results">
              {visible.map((item, i) => (
                <li
                  key={`${item.category}/${item.slug}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={`flex cursor-pointer items-center gap-3 border-b border-navy-50 px-4 py-3 ${
                    i === active ? 'bg-brand-50' : ''
                  }`}
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
                    <p className="truncate text-xs text-navy-600">
                      {item.categoryTitle} · {item.files.length} file{item.files.length > 1 ? 's' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!showAll && results.length > INITIAL_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full px-4 py-3 text-sm font-semibold text-brand-600 hover:bg-navy-50"
            >
              Show all {results.length} results
            </button>
          )}

          {!q && (
            <p className="px-4 py-8 text-center text-sm text-navy-600">
              Start typing to search {allItems.length} marketing assets.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Keep Tab / Shift+Tab inside the dialog. */
function trapFocus(e, container) {
  if (!container) return;
  const focusable = container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function TypeGlyph({ types }) {
  const label = types.includes('video') ? '▶' : types.includes('pdf') ? 'PDF' : '★';
  return (
    <span className="text-xs font-semibold text-navy-500" aria-hidden="true">
      {label}
    </span>
  );
}
