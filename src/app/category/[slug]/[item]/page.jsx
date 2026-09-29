import Link from 'next/link';
import { notFound } from 'next/navigation';
import DownloadList from '@/components/DownloadList';
import AssetPreview from '@/components/AssetPreview';
import CopyBlock from '@/components/CopyBlock';
import FavoriteButton from '@/components/FavoriteButton';
import { getCategories, getCategory, getItem } from '@/lib/catalog';
import { getPost, postToItem } from '@/lib/posts';

// ISR so admin-added item pages render on demand and stay fresh.
export const revalidate = 30;

export function generateStaticParams() {
  const params = [];
  for (const cat of getCategories()) {
    for (const item of cat.items) {
      params.push({ slug: cat.slug, item: item.slug });
    }
  }
  return params;
}

// Look up a catalog item first, then fall back to an admin-added post.
async function resolveItem(slug, itemSlug) {
  const fromCatalog = getItem(slug, itemSlug);
  if (fromCatalog) return fromCatalog;
  const post = await getPost(slug, itemSlug);
  return post ? postToItem(post) : null;
}

export async function generateMetadata({ params }) {
  const { slug, item: itemSlug } = await params;
  const item = await resolveItem(slug, itemSlug);
  if (!item) return {};
  return { title: item.title };
}

export default async function ItemPage({ params }) {
  const { slug, item: itemSlug } = await params;
  const category = getCategory(slug);
  const item = await resolveItem(slug, itemSlug);
  if (!category || !item) notFound();

  const hasHashtags = Array.isArray(item.hashtags) && item.hashtags.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-navy-600">
        <ol className="flex flex-wrap items-center">
          <li>
            <Link href="/" className="hover:text-brand-600">
              Home
            </Link>
          </li>
          <li className="flex items-center">
            <span className="px-1.5" aria-hidden="true">/</span>
            <Link href={`/category/${category.slug}`} className="hover:text-brand-600">
              {category.title}
            </Link>
          </li>
          <li className="flex items-center">
            <span className="px-1.5" aria-hidden="true">/</span>
            <span aria-current="page" className="font-medium text-navy-800">{item.title}</span>
          </li>
        </ol>
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
          <FavoriteButton item={item} category={category.slug} variant="full" className="mt-4" />
          <p className="mt-3 text-navy-500">
            {item.files.length} file{item.files.length > 1 ? 's' : ''} available to download. Click any
            file to download it directly — no login required.
          </p>

          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-navy-600">
            Downloads
          </h2>
          <DownloadList files={item.files} />

          {item.caption && (
            <div className="mt-8">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-navy-600">
                Suggested caption
              </h2>
              <CopyBlock text={item.caption}>
                <p className="whitespace-pre-wrap text-sm text-navy-700">{item.caption}</p>
              </CopyBlock>
            </div>
          )}

          {hasHashtags && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-navy-600">
                Hashtags
              </h2>
              <CopyBlock text={item.hashtags.map((h) => `#${h}`).join(' ')}>
                <div className="flex flex-wrap gap-1.5">
                  {item.hashtags.map((h) => (
                    <span key={h} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                      #{h}
                    </span>
                  ))}
                </div>
              </CopyBlock>
            </div>
          )}

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
