import Link from 'next/link';
import { notFound } from 'next/navigation';
import ItemCard from '@/components/ItemCard';
import RequestFormCTA from '@/components/RequestFormCTA';
import { getCategories, getCategory } from '@/lib/catalog';
import { postsForCategory, postToItem } from '@/lib/posts';
import { isNew } from '@/lib/groups';

// ISR: regenerate periodically so admin-added pieces appear without a redeploy.
export const revalidate = 30;

export function generateStaticParams() {
  return getCategories().map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const cat = getCategory(slug);
  if (!cat) return {};
  return { title: cat.title, description: cat.description };
}

export default async function CategoryPage({ params }) {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) notFound();

  // Merge in admin-added pieces. Recently added ones are highlighted separately.
  const adminItems = (await postsForCategory(slug)).map(postToItem);
  const justAdded = adminItems.filter((i) => isNew(i.createdAt));
  const settled = adminItems.filter((i) => !isNew(i.createdAt));
  const mergedItems = [...settled, ...category.items].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <nav className="mb-6 text-sm text-navy-400">
        <Link href="/" className="hover:text-brand-600">Home</Link>{' '}
        <span className="px-1">/</span>
        <span className="text-navy-600">{category.title}</span>
      </nav>

      <header className="mb-10 max-w-3xl">
        <h1 className="text-3xl font-bold text-navy-900 sm:text-4xl">{category.title}</h1>
        <p className="mt-3 text-navy-500">{category.description}</p>
        <p className="mt-4 text-sm font-medium text-navy-400">
          {mergedItems.length + justAdded.length} items · {category.fileCount + adminItems.length} downloadable files
        </p>
      </header>

      {category.requestForm && <RequestFormCTA category={category} />}

      {justAdded.length > 0 && <JustAdded items={justAdded} categorySlug={category.slug} />}

      {mergedItems.length === 0 ? (
        justAdded.length === 0 && (
          <p className="rounded-xl border border-dashed border-navy-200 p-10 text-center text-navy-400">
            Assets for this category are being added.
          </p>
        )
      ) : category.groups ? (
        <GroupedItems category={category} items={mergedItems} />
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {mergedItems.map((item) => (
            <ItemCard key={item.slug} item={item} categorySlug={category.slug} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Highlighted strip of pieces added within the last 10 days. */
function JustAdded({ items, categorySlug }) {
  return (
    <section className="mb-12 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-lg">✨</span>
        <h2 className="text-lg font-bold text-navy-900">Just Added</h2>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
          New · {items.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <ItemCard key={item.slug} item={item} categorySlug={categorySlug} />
        ))}
      </div>
    </section>
  );
}

/** Category items grouped by meaning, with a sticky quick-jump bar. */
function GroupedItems({ category, items }) {
  const itemsByGroup = new Map();
  for (const item of items) {
    const key = item.group || 'other';
    if (!itemsByGroup.has(key)) itemsByGroup.set(key, []);
    itemsByGroup.get(key).push(item);
  }
  // Preserve the curated group order; only show groups that have items now.
  const groups = category.groups
    .map((g) => ({ ...g, count: (itemsByGroup.get(g.key) || []).length }))
    .filter((g) => g.count > 0);

  return (
    <div>
      <div className="sticky top-16 z-30 -mx-4 mb-8 border-b border-navy-100 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        <div className="flex gap-2 overflow-x-auto">
          {groups.map((g) => (
            <a key={g.key} href={`#${g.key}`}
              className="whitespace-nowrap rounded-full border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:border-brand-400 hover:text-brand-600">
              {g.title} <span className="text-navy-300">{g.count}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="space-y-14">
        {groups.map((g) => (
          <section key={g.key} id={g.key} className="scroll-mt-32">
            <div className="mb-5 flex items-baseline gap-3 border-b border-navy-100 pb-2">
              <h2 className="text-xl font-bold text-navy-900">{g.title}</h2>
              <span className="text-sm text-navy-400">{g.count}</span>
            </div>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {(itemsByGroup.get(g.key) || []).map((item) => (
                <ItemCard key={item.slug} item={item} categorySlug={category.slug} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
