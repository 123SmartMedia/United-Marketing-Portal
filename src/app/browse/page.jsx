import Link from 'next/link';
import ItemCard from '@/components/ItemCard';
import FilteredCatalog from '@/components/filters/FilteredCatalog';
import { getCategories } from '@/lib/catalog';
import { readPosts, postToItem } from '@/lib/posts';

// ISR: regenerate periodically so admin-added pieces appear without a redeploy.
export const revalidate = 30;

export const metadata = {
  title: 'Browse all assets',
  description: 'The complete United Mortgage marketing library.',
};

export default async function BrowsePage() {
  const categories = getCategories();

  // Admin-added pieces, grouped by the category they were added to.
  const posts = (await readPosts()).filter((p) => p.published !== false);
  const sections = categories.map((category) => {
    const adminItems = posts.filter((p) => p.category === category.slug).map(postToItem);
    const items = [...adminItems, ...category.items]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((item) => ({ ...item, category: category.slug, categoryTitle: category.title }));
    return { category, items };
  });
  const allItems = sections.flatMap((s) => s.items);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header id="top" className="mb-8 scroll-mt-24">
        <h1 className="text-3xl font-bold text-navy-900 sm:text-4xl">Browse all assets</h1>
        <p className="mt-3 text-navy-500">
          {allItems.length} items across {categories.length} categories.
        </p>
        <nav aria-label="Jump to category" className="mt-6 flex flex-wrap gap-2">
          {sections.map(({ category, items }) => (
            <a
              key={category.slug}
              href={`#${category.slug}`}
              className="rounded-full border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:border-brand-400 hover:text-brand-600"
            >
              {category.title} <span className="text-navy-500">{items.length}</span>
            </a>
          ))}
        </nav>
      </header>

      <FilteredCatalog items={allItems}>
        <div className="space-y-16">
          {sections.map(({ category, items }) => (
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
                {items.map((item) => (
                  <ItemCard key={item.slug} item={item} categorySlug={category.slug} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </FilteredCatalog>

      <div className="mt-12 text-center">
        <a
          href="#top"
          className="inline-flex min-h-11 items-center rounded-full border border-navy-200 px-5 text-sm font-semibold text-navy-700 hover:border-brand-500 hover:text-brand-700"
        >
          <span aria-hidden="true" className="mr-1.5">↑</span> Back to top
        </a>
      </div>
    </div>
  );
}
