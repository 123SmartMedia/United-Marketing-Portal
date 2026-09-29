import 'server-only';

import { readPosts, postToItem } from './posts.js';
import { getCategory } from './catalog.js';

/**
 * Published admin-added pieces, newest first, shaped like catalog items with
 * their category attached. Read-only; failures read as "nothing new".
 */
export async function getRecentPosts(limit = Infinity) {
  const posts = await readPosts();
  return posts
    .filter((p) => p.published !== false)
    .map((p) => {
      const category = getCategory(p.category);
      return category ? { ...postToItem(p), category: category.slug, categoryTitle: category.title } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}
