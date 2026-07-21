import Link from 'next/link';
import ItemCard from '@/components/ItemCard';
import { getCategories, getAllItems } from '@/lib/catalog';

export const metadata = {
  title: 'Browse all assets',
  description: 'The complete United Mortgage marketing library.',
};

export default function BrowsePage() {
  const categories = getCategories();
  const total = getAllItems().length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-navy-900 sm:text-4xl">Browse all assets</h1>
        <p className="mt-3 text-navy-500">{total} items across {categories.length} categories.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {categories.map((c) => (
            <a
              key={c.slug}
              href={`#${c.slug}`}
              className="rounded-full border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:border-brand-400 hover:text-brand-600"
            >
              {c.title}
            </a>
          ))}
        </div>
      </header>

      <div className="space-y-16">
        {categories.map((category) => (
          <section key={category.slug} id={category.slug} className="scroll-mt-20">
            <div className="mb-5 flex items-end justify-between border-b border-navy-100 pb-3">
              <h2 className="text-xl font-bold text-navy-900">{category.title}</h2>
              <Link
                href={`/category/${category.slug}`}
                className="text-sm font-semibold text-brand-600 hover:text-brand-700"
              >
                Open category →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {category.items.map((item) => (
                <ItemCard key={item.slug} item={item} categorySlug={category.slug} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
