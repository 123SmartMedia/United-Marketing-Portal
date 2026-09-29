'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

/** Friendly fallback when a page fails to render. */
export default function Error({ error, reset }) {
  const headingRef = useRef(null);

  useEffect(() => {
    console.error('[page error]', error?.digest || error?.message);
    headingRef.current?.focus();
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-navy-900 focus:outline-none sm:text-3xl">
        Something went wrong on our end
      </h1>
      <p className="mt-3 text-navy-600">
        This page didn’t load. Try again — if it keeps happening, email{' '}
        <a href="mailto:marketing@unitedmortgage.com" className="font-semibold text-brand-600 underline">
          marketing@unitedmortgage.com
        </a>
        .
      </p>
      {error?.digest && <p className="mt-2 text-xs text-navy-500">Reference: {error.digest}</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-navy-300 px-6 py-3 text-sm font-semibold text-navy-800 transition hover:border-brand-500"
        >
          Go to the homepage
        </Link>
      </div>
    </div>
  );
}
