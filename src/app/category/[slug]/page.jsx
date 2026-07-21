import Link from 'next/link';
import { notFound } from 'next/navigation';
import ItemCard from '@/components/ItemCard';
import RequestFormCTA from '@/components/RequestFormCTA';
import { getCategories, getCategory } from '@/lib/catalog';

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <nav className="mb-6 text-sm text-navy-400">
        <Link href="/" className="hover:text-brand-600">
          Home
        </Link>{' '}
        <span className="px-1">/</span>
        <span className="text-navy-600">{category.title}</span>
      </nav>

      <header className="mb-10 max-w-3xl">
        <h1 className="text-3xl font-bold text-navy-900 sm:text-4xl">{category.title}</h1>
        <p className="mt-3 text-navy-500">{category.description}</p>
        <p className="mt-4 text-sm font-medium text-navy-400">
          {category.itemCount} items · {category.fileCount} downloadable files
        </p>
      </header>

      {category.requestForm && <RequestFormCTA category={category} />}

      {category.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-navy-200 p-10 text-center text-navy-400">
          Assets for this category are being added.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {category.items.map((item) => (
            <ItemCard key={item.slug} item={item} categorySlug={category.slug} />
          ))}
        </div>
      )}
    </div>
  );
}
