'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import ItemCard from '@/components/ItemCard';
import { useFavorites } from '@/components/useFavorites';
import { favoriteKey } from '@/lib/favorites';

/**
 * Resolves each saved entry against current data — the catalog (passed in)
 * plus admin-added pieces (fetched) — so cards show today's files. Entries
 * that no longer exist are flagged with a remove button instead of a dead link.
 */
export default function MyKit({ catalog }) {
  const { favorites, remove, clear } = useFavorites();
  const [posts, setPosts] = useState(null); // null = loading; [] on failure

  useEffect(() => {
    let cancelled = false;
    fetch('/api/search/posts')
      .then((r) => r.json())
      .then((json) => !cancelled && setPosts(Array.isArray(json.items) ? json.items : []))
      .catch(() => !cancelled && setPosts([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const index = useMemo(() => {
    const map = new Map();
    for (const i of catalog) map.set(favoriteKey(i.category, i.slug), i);
    for (const i of posts || []) map.set(favoriteKey(i.category, i.slug), i);
    return map;
  }, [catalog, posts]);

  function clearAll() {
    if (confirm('Remove everything from My kit?')) clear();
  }

  if (favorites.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-dashed border-navy-200 p-10 text-center">
        <p className="text-lg font-semibold text-navy-900">Your kit is empty</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-navy-600">
          Tap the heart on any flyer, video, or post to save it here, so the pieces you use most are
          always one click away.
        </p>
        <Link
          href="/browse"
          className="mt-6 inline-block rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Browse the library
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mt-8 flex items-center justify-between">
        <p className="text-sm text-navy-600" aria-live="polite">
          {favorites.length} saved {favorites.length === 1 ? 'piece' : 'pieces'}
        </p>
        <button
          type="button"
          onClick={clearAll}
          className="min-h-11 rounded-full border border-navy-200 px-4 text-sm font-medium text-navy-700 hover:border-red-300 hover:text-red-700"
        >
          Clear kit
        </button>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {favorites.map((entry) => {
          const key = favoriteKey(entry.category, entry.slug);
          const current = index.get(key);
          return (
            <li key={key}>
              {current ? (
                <ItemCard item={current} categorySlug={entry.category} />
              ) : posts === null ? (
                <Pending entry={entry} />
              ) : (
                <Unavailable entry={entry} onRemove={() => remove(entry.category, entry.slug)} />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Pending({ entry }) {
  return (
    <div className="flex h-full min-h-48 flex-col justify-end rounded-2xl border border-navy-100 bg-navy-50/50 p-4" aria-busy="true">
      <p className="text-sm font-semibold text-navy-900">{entry.title}</p>
      <p className="mt-1 text-xs text-navy-600">Loading…</p>
    </div>
  );
}

function Unavailable({ entry, onRemove }) {
  return (
    <div className="flex h-full min-h-48 flex-col rounded-2xl border border-dashed border-navy-200 bg-white p-4">
      <p className="text-sm font-semibold text-navy-900">{entry.title}</p>
      <p className="mt-1 flex-1 text-xs text-navy-600">No longer available — it may have been removed from the library.</p>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${entry.title} from My kit`}
        className="mt-3 min-h-11 self-start rounded-full border border-navy-200 px-4 text-sm font-medium text-navy-700 hover:border-red-300 hover:text-red-700"
      >
        Remove
      </button>
    </div>
  );
}
