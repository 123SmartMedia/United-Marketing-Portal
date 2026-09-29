import Link from 'next/link';

import ItemCard from '@/components/ItemCard';
import { getRecentPosts } from '@/lib/recentPosts';
import { groupByRecency } from '@/lib/whatsNew';

// Same freshness as the category pages that show these pieces.
export const revalidate = 30;

export const metadata = {
  title: 'What’s new',
  description: 'The latest marketing pieces added to the United Marketing Desk.',
};

export default async function WhatsNewPage() {
  const groups = groupByRecency(await getRecentPosts());

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-navy-900">What’s new</h1>
      <p className="mt-2 max-w-2xl text-navy-600">
        The latest pieces added by the marketing team, newest first.
      </p>

      {groups.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-navy-200 p-10 text-center">
          <p className="text-lg font-semibold text-navy-900">Nothing new yet</p>
          <p className="mt-2 text-sm text-navy-600">When marketing adds new pieces, they’ll show up here first.</p>
          <Link href="/browse" className="mt-6 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
            Browse the full library →
          </Link>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="mt-10" aria-labelledby={`new-${group.key}`}>
            <h2 id={`new-${group.key}`} className="text-lg font-bold text-navy-900">
              {group.title} <span className="font-normal text-navy-600">({group.items.length})</span>
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {group.items.map((item) => (
                <li key={`${item.category}/${item.slug}`}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700">{item.categoryTitle}</p>
                  <ItemCard item={item} categorySlug={item.category} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
