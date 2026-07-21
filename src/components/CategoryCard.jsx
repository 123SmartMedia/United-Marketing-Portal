import Link from 'next/link';

/**
 * Circular category card for the homepage grid — recreates the current site's
 * signature ring of 8 circular category thumbnails.
 */
export default function CategoryCard({ category }) {
  return (
    <Link href={`/category/${category.slug}`} className="group flex flex-col items-center text-center">
      <div className="relative aspect-square w-full overflow-hidden rounded-full border-4 border-white shadow-md ring-1 ring-navy-100 transition group-hover:-translate-y-1 group-hover:shadow-xl group-hover:ring-brand-300">
        {category.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={category.image}
            alt={category.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-500 to-navy-700" />
        )}
        <div className="absolute inset-0 bg-navy-900/0 transition group-hover:bg-navy-900/10" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-navy-900 group-hover:text-brand-600">
        {category.title}
      </h3>
      <p className="mt-1 text-xs text-navy-400">{category.itemCount} items</p>
    </Link>
  );
}
