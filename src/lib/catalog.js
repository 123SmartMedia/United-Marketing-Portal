import catalog from '@/content/catalog.json';

/** Site-wide constants (also mirrored in the catalog for the build script). */
export const SITE = catalog.site;
export const TOTALS = catalog.totals;

/** All categories, in curated order. */
export function getCategories() {
  return catalog.categories;
}

/** Categories that appear as circular cards on the homepage. */
export function getCardCategories() {
  return catalog.categories.filter((c) => c.card);
}

/** A single category by slug. */
export function getCategory(slug) {
  return catalog.categories.find((c) => c.slug === slug) || null;
}

/** A single item within a category. */
export function getItem(categorySlug, itemSlug) {
  const cat = getCategory(categorySlug);
  if (!cat) return null;
  return cat.items.find((i) => i.slug === itemSlug) || null;
}

/** Flatten every item across categories (for search + featured selection). */
export function getAllItems() {
  const out = [];
  for (const cat of catalog.categories) {
    for (const item of cat.items) {
      out.push({
        ...item,
        category: cat.slug,
        categoryTitle: cat.title,
      });
    }
  }
  return out;
}

/** A handful of items with real thumbnails, for the homepage "featured" strip. */
export function getFeaturedItems(limit = 8) {
  const withThumbs = getAllItems().filter((i) => i.thumbnail && i.types.includes('image'));
  // Spread across categories for variety.
  const seen = new Map();
  const spread = [];
  for (const item of withThumbs) {
    const n = seen.get(item.category) || 0;
    if (n < 2) {
      spread.push(item);
      seen.set(item.category, n + 1);
    }
  }
  return spread.slice(0, limit);
}
