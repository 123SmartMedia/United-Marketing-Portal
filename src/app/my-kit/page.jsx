import MyKit from './MyKit';
import { getAllItems } from '@/lib/catalog';

export const metadata = {
  title: 'My kit',
  description: 'The marketing pieces you’ve saved on this device.',
};

/** Only the fields a card needs, so the page doesn't ship the whole catalog. */
function liteCatalog() {
  return getAllItems().map((i) => ({
    category: i.category,
    categoryTitle: i.categoryTitle,
    slug: i.slug,
    title: i.title,
    thumbnail: i.thumbnail || null,
    types: i.types,
    files: i.files.map((f) => ({ type: f.type, brand: f.brand, lang: f.lang })),
  }));
}

export default function MyKitPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-navy-900">My kit</h1>
      <p className="mt-2 max-w-2xl text-navy-600">
        Pieces you’ve saved for quick access. Your kit is saved in this browser on this device only.
      </p>
      <MyKit catalog={liteCatalog()} />
    </div>
  );
}
