import Link from 'next/link';
import { notFound } from 'next/navigation';
import DownloadList from '@/components/DownloadList';
import AssetPreview from '@/components/AssetPreview';
import { getCategories, getCategory, getItem } from '@/lib/catalog';

export function generateStaticParams() {
  const params = [];
  for (const cat of getCategories()) {
    for (const item of cat.items) {
      params.push({ slug: cat.slug, item: item.slug });
    }
  }
  return params;
}

export async function generateMetadata({ params }) {
  const { slug, item: itemSlug } = await params;
  const item = getItem(slug, itemSlug);
  if (!item) return {};
  return { title: item.title };
}

export default async function ItemPage({ params }) {
  const { slug, item: itemSlug } = await params;
  const category = getCategory(slug);
  const item = getItem(slug, itemSlug);
  if (!category || !item) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <nav className="mb-6 text-sm text-navy-400">
        <Link href="/" className="hover:text-brand-600">
          Home
        </Link>
        <span className="px-1">/</span>
        <Link href={`/category/${category.slug}`} className="hover:text-brand-600">
          {category.title}
        </Link>
        <span className="px-1">/</span>
        <span className="text-navy-600">{item.title}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <AssetPreview item={item} />
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-500">
            {category.title}
          </p>
          <h1 className="mt-2 text-3xl font-bold text-navy-900">{item.title}</h1>
          <p className="mt-3 text-navy-500">
            {item.files.length} file{item.files.length > 1 ? 's' : ''} available to download. Click any
            file to download it directly — no login required.
          </p>

          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-navy-400">
            Downloads
          </h2>
          <DownloadList files={item.files} />

          <div className="mt-8 rounded-xl bg-navy-50 p-5 text-sm text-navy-600">
            Need this customized or cobranded a different way?{' '}
            <Link href="/custom-requests" className="font-semibold text-brand-600 hover:text-brand-700">
              Submit a custom request →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
