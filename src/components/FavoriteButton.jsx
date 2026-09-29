'use client';

import { useState } from 'react';
import { useFavorites } from './useFavorites';
import { hasFavorite, toEntry } from '@/lib/favorites';

/**
 * Heart toggle that saves an item to "My kit" on this device.
 * `variant="overlay"` sits on a card thumbnail; `variant="full"` is a labelled
 * button for the item detail page.
 */
export default function FavoriteButton({ item, category, variant = 'overlay', className = '' }) {
  const { favorites, toggle } = useFavorites();
  const [announcement, setAnnouncement] = useState('');
  const saved = hasFavorite(favorites, category, item.slug);
  const label = saved ? `Remove ${item.title} from My kit` : `Save ${item.title} to My kit`;

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    toggle(toEntry(item, category));
    setAnnouncement(saved ? `Removed ${item.title} from My kit` : `Saved ${item.title} to My kit`);
  }

  const heart = (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className={saved ? 'text-rose-600' : 'text-navy-600'}>
      <path
        d="M12 20.5s-7.5-4.6-9.3-9.3C1.5 8 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.5 4.5 6.7-1.8 4.7-9.3 9.3-9.3 9.3Z"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <>
      {variant === 'full' ? (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={saved}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
            saved ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-navy-200 bg-white text-navy-700 hover:border-brand-400'
          } ${className}`}
        >
          {heart}
          {saved ? 'Saved to My kit' : 'Save to My kit'}
        </button>
      ) : (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={saved}
          aria-label={label}
          title={saved ? 'Remove from My kit' : 'Save to My kit'}
          className={`flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow transition hover:scale-105 ${className}`}
        >
          {heart}
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
