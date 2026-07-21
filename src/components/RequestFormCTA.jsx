'use client';

import { useState } from 'react';
import RequestForm from './RequestForm';

/**
 * Collapsible request-form banner shown on categories that order printed
 * materials (e.g. Business Cards & Stationery), replacing the current site's
 * embedded email request forms.
 */
export default function RequestFormCTA({ category }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-10 overflow-hidden rounded-2xl border border-brand-200 bg-brand-50/50">
      <div className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-navy-900">Order or request {category.title}</h2>
          <p className="mt-1 text-sm text-navy-500">
            Request printed materials or a customization — it goes straight to the marketing desk.
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
        >
          {open ? 'Close form' : 'Request now'}
        </button>
      </div>
      {open && (
        <div className="border-t border-brand-200 bg-white p-6">
          <RequestForm defaultType={category.title} asset={category.title} />
        </div>
      )}
    </div>
  );
}
