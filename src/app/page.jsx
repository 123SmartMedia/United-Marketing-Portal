import Link from 'next/link';
import CategoryCard from '@/components/CategoryCard';
import ItemCard from '@/components/ItemCard';
import { getCardCategories, getFeaturedItems, getAllItems, TOTALS } from '@/lib/catalog';

export default function HomePage() {
  const categories = getCardCategories();
  const featured = getFeaturedItems(8);
  const totalItems = getAllItems().length;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-brand-800 text-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-200">
            United Mortgage · Marketing Desk
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Everything you need to market{' '}
            <span className="text-brand-300">United Mortgage</span>.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-navy-100">
            Flyers, videos, social content, and print collateral for every loan program —
            ready to download and share. No logins, no waiting.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/get-started"
              className="rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-400"
            >
              Get Started
            </Link>
            <Link
              href="/browse"
              className="rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Browse all {totalItems} assets
            </Link>
          </div>
        </div>
      </section>

      {/* Category grid */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold text-navy-900 sm:text-3xl">Browse by category</h2>
          <p className="mt-2 text-navy-500">Pick a category to see every available asset.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c) => (
            <CategoryCard key={c.slug} category={c} />
          ))}
        </div>
      </section>

      {/* Featured strip */}
      {featured.length > 0 && (
        <section className="bg-navy-50/60 py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 flex items-end justify-between">
              <div>
                <h2 className="text-2xl font-bold text-navy-900">Featured assets</h2>
                <p className="mt-1 text-navy-500">A sample of what's in the library.</p>
              </div>
              <Link href="/browse" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {featured.map((item) => (
                <ItemCard key={`${item.category}/${item.slug}`} item={item} categorySlug={item.category} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Get Started CTA */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-r from-navy-900 to-brand-700 px-8 py-14 text-center text-white sm:px-16">
          <h2 className="text-3xl font-bold">New to United Mortgage?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-navy-100">
            Get set up with your personalized business cards, cobranded materials, and everything
            you need to start marketing on day one.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/get-started"
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-navy-900 transition hover:bg-navy-100"
            >
              Get Started
            </Link>
            <Link
              href="/custom-requests"
              className="rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Submit a Custom Request
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
