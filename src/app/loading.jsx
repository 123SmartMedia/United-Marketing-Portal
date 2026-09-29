export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-64 animate-pulse rounded-lg bg-navy-100" aria-hidden="true" />
      <div className="mt-4 h-4 w-96 max-w-full animate-pulse rounded bg-navy-50" aria-hidden="true" />
      <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-[4/3] animate-pulse rounded-2xl bg-navy-50" />
        ))}
      </div>
    </div>
  );
}
