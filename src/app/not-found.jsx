import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-28 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">404</p>
      <h1 className="mt-3 text-3xl font-bold text-navy-900">Page not found</h1>
      <p className="mt-3 text-navy-500">
        That asset or page doesn't exist. Try browsing the library or searching from the header.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600">
          Go home
        </Link>
        <Link href="/browse" className="rounded-full border border-navy-200 px-5 py-2.5 text-sm font-semibold text-navy-700 hover:border-brand-400">
          Browse all assets
        </Link>
      </div>
    </div>
  );
}
