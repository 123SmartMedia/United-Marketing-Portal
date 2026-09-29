import { NextResponse } from 'next/server';
import { readPosts, postToItem } from '@/lib/posts';
import { getCategory } from '@/lib/catalog';

export const runtime = 'nodejs';
// Same freshness as the category pages that show these pieces.
export const revalidate = 30;

/**
 * Published admin-added pieces, shaped like catalog items, so the header search
 * finds them too. Public: it exposes exactly what the category pages already show.
 */
export async function GET() {
  const posts = await readPosts();
  const items = posts
    .filter((p) => p.published !== false)
    .map((p) => {
      const category = getCategory(p.category);
      if (!category) return null;
      return { ...postToItem(p), category: category.slug, categoryTitle: category.title };
    })
    .filter(Boolean);

  return NextResponse.json(
    { ok: true, items },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
  );
}
