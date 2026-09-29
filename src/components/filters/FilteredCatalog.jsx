'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import ItemCard from '@/components/ItemCard';
import FilterBar from './FilterBar';
import {
  applyFilters,
  deriveFacets,
  emptySelection,
  hasDates,
  isFiltering,
  selectionFromSearchParams,
  toSearchParams,
  toggleOption,
} from '@/lib/filters';

/**
 * Filter bar over a list of items. With no filters (and the default sort) it
 * renders `children` — the page's normal grouped layout — unchanged; once
 * anything is selected it switches to a flat, filtered grid. State lives in the
 * URL so a filtered view can be shared or bookmarked.
 *
 * `useSearchParams` needs a Suspense boundary on statically rendered pages, so
 * the export wraps it; the fallback is the unfiltered layout, which is also
 * exactly what the prerendered HTML should show.
 */
export default function FilteredCatalog(props) {
  return (
    <Suspense fallback={props.children}>
      <FilteredCatalogInner {...props} />
    </Suspense>
  );
}

function FilteredCatalogInner({ items, categorySlug, groupTitles, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selection = useMemo(() => selectionFromSearchParams(searchParams), [searchParams]);
  const ctx = useMemo(() => ({ groupTitles }), [groupTitles]);
  const facets = useMemo(() => deriveFacets(items, selection, ctx), [items, selection, ctx]);
  const results = useMemo(() => applyFilters(items, selection, ctx), [items, selection, ctx]);
  const filtering = isFiltering(selection);

  const update = useCallback(
    (next) => {
      const qs = toSearchParams(next, searchParams).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const clear = () => update(emptySelection());

  if (!facets.length && !hasDates(items)) return children;

  return (
    <>
      <FilterBar
        facets={facets}
        selection={selection}
        resultCount={results.length}
        totalCount={items.length}
        showNewest={hasDates(items)}
        onToggle={(key, value) => update(toggleOption(selection, key, value))}
        onSort={(sort) => update({ ...selection, sort })}
        onClear={clear}
      />

      {!filtering ? (
        children
      ) : results.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-navy-200 p-10 text-center">
          <p className="font-semibold text-navy-900">No items match these filters.</p>
          <button
            type="button"
            onClick={clear}
            className="mt-4 min-h-11 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((item) => {
            const slug = item.category || categorySlug;
            return <ItemCard key={`${slug}/${item.slug}`} item={item} categorySlug={slug} />;
          })}
        </div>
      )}
    </>
  );
}
