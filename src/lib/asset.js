/**
 * Resolves a catalog asset path (stored relative, e.g. "Program-Flyers/x.pdf")
 * to a full URL using the configured base.
 *
 *  - Production (Vercel): NEXT_PUBLIC_ASSET_BASE_URL = the Cloudflare R2 public
 *    URL (https://pub-...r2.dev or a custom assets subdomain).
 *  - Local dev / unset: '/assets' — served by the public/assets junction.
 *
 * NEXT_PUBLIC_ is required so the value is inlined into client components
 * (thumbnails, previews) as well as server-rendered pages.
 */
const BASE = (process.env.NEXT_PUBLIC_ASSET_BASE_URL || '/assets').replace(/\/+$/, '');

export function assetUrl(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//.test(pathOrUrl) || pathOrUrl.startsWith('/assets')) return pathOrUrl;
  return `${BASE}/${pathOrUrl.replace(/^\/+/, '')}`;
}

export const ASSET_BASE = BASE;
