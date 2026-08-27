import Link from 'next/link';
import AssetThumb from './AssetThumb';
import { isNew } from '@/lib/groups';

/** Grid card linking to an item's detail page. Used on category and browse pages. */
export default function ItemCard({ item, categorySlug }) {
  const fileCount = item.files.length;
  const badges = describeBadges(item);
  const fresh = isNew(item.createdAt);
  return (
    <Link
      href={`/category/${categorySlug}/${item.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-navy-100 bg-white transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg"
    >
      {fresh && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-950 shadow">
          New
        </span>
      )}
      <AssetThumb item={item} rounded="rounded-none" className="aspect-[4/3] w-full" />
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 text-sm font-semibold text-navy-900 group-hover:text-brand-600">
          {item.title}
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span
              key={b}
              className="rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-medium text-navy-500"
            >
              {b}
            </span>
          ))}
        </div>
        <p className="mt-auto pt-3 text-xs text-navy-400">
          {fileCount} download{fileCount > 1 ? 's' : ''}
        </p>
      </div>
    </Link>
  );
}

function describeBadges(item) {
  const badges = new Set();
  for (const f of item.files) {
    if (f.type === 'video') badges.add('Video');
    if (f.type === 'pdf') badges.add('PDF');
    if (f.type === 'image') badges.add('Image');
    if (f.brand === 'Cobranded') badges.add('Cobranded');
    if (f.lang === 'Spanish') badges.add('EN/ES');
  }
  return [...badges].slice(0, 3);
}
