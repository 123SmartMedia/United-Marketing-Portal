'use client';

import { useSyncExternalStore } from 'react';
import { createFavoritesStore } from '@/lib/favorites';

/** One store per browser tab, shared by every component that uses it. */
const store =
  typeof window === 'undefined'
    ? createFavoritesStore({ getStorage: () => null })
    : createFavoritesStore({ getStorage: () => window.localStorage, target: window });

/** Saved favorites ("My kit") plus actions. Empty during server render. */
export function useFavorites() {
  const favorites = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { favorites, toggle: store.toggle, remove: store.remove, clear: store.clear };
}
