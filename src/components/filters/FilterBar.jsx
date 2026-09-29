'use client';

import { useId, useState } from 'react';
import { SORTS, activeCount } from '@/lib/filters';

/**
 * Facet chips + sort. Purely presentational: the parent owns the selection
 * and the URL. Chips are toggle buttons (`aria-pressed`) with ≥44px touch
 * targets on mobile; on small screens the facets collapse behind a
 * "Filters" button so they don't push the results off-screen.
 */
export default function FilterBar({ facets, selection, resultCount, totalCount, showNewest, onToggle, onSort, onClear }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const sortId = useId();
  const active = activeCount(selection);
  const filtering = active > 0;

  return (
    <div className="mb-8 rounded-2xl border border-navy-100 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="min-h-11 rounded-full border border-navy-200 px-4 text-sm font-semibold text-navy-800 transition hover:border-brand-500 sm:hidden"
        >
          Filters{active ? ` (${active})` : ''}
        </button>

        <p className="text-sm text-navy-700" aria-live="polite" aria-atomic="true">
          {filtering || resultCount !== totalCount ? (
            <>
              Showing <span className="font-semibold text-navy-900">{resultCount}</span> of {totalCount} items
            </>
          ) : (
            <>{totalCount} items</>
          )}
        </p>

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor={sortId} className="text-sm text-navy-700">
            Sort
          </label>
          <select
            id={sortId}
            value={selection.sort}
            onChange={(e) => onSort(e.target.value)}
            className="min-h-11 rounded-full border border-navy-200 bg-white px-3 text-sm text-navy-900 sm:min-h-9"
          >
            <option value={SORTS.AZ}>A–Z</option>
            {showNewest && <option value={SORTS.NEWEST}>Newest first</option>}
          </select>
          {filtering && (
            <button
              type="button"
              onClick={onClear}
              className="min-h-11 rounded-full px-3 text-sm font-semibold text-brand-600 hover:text-brand-700 hover:underline sm:min-h-9"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <div id={panelId} className={`${open ? 'mt-4 block' : 'hidden'} space-y-4 sm:mt-4 sm:block`}>
        {facets.map((facet) => (
          <fieldset key={facet.key} className="flex flex-wrap items-center gap-2">
            <legend className="float-left mr-2 w-full text-xs font-semibold uppercase tracking-wide text-navy-600 sm:w-24">
              {facet.title}
            </legend>
            {facet.options.map((opt) => {
              const disabled = !opt.selected && opt.count === 0;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={opt.selected}
                  disabled={disabled}
                  onClick={() => onToggle(facet.key, opt.value)}
                  className={`min-h-11 rounded-full border px-3.5 text-sm font-medium transition sm:min-h-9 ${
                    opt.selected
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : disabled
                        ? 'cursor-not-allowed border-navy-100 text-navy-400'
                        : 'border-navy-200 text-navy-700 hover:border-brand-500 hover:text-brand-700'
                  }`}
                >
                  {opt.label}
                  <span className={`ml-1.5 text-xs ${opt.selected ? 'text-brand-100' : 'text-navy-500'}`}>{opt.count}</span>
                </button>
              );
            })}
          </fieldset>
        ))}
      </div>
    </div>
  );
}
