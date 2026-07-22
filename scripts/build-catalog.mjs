/**
 * build-catalog.mjs
 * -----------------
 * Scans the United Marketing Desk asset library and produces a structured
 * catalog (src/content/catalog.json) that drives every page on the site.
 *
 * Design intent (per project plan §3): the entire site catalog lives as
 * structured content rather than hard-coded pages, so adding/updating an asset
 * is a one-file (or one-drop) change, and the same data can later feed Total
 * Expert asset syncing in Phase 2.
 *
 * The script derives ITEMS by normalizing filenames (stripping variant/quality
 * tokens) and grouping files that share a base name. Category-level metadata
 * (titles, ordering, homepage cards) comes from the curated CATEGORIES map so
 * the auto-scan never controls presentation.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'UnitedMarketingDesk-Assets');
const OUT_FILE = path.join(ROOT, 'src', 'content', 'catalog.json');

// Public URL base for assets.
//  - Local dev / no env: '/assets' (served via the public/assets junction).
//  - Production: set ASSET_BASE_URL to the R2 public bucket URL (e.g.
//    https://assets.marketing.unitedmortgage.com) and the catalog bakes
//    absolute CDN URLs. Vercel runs prebuild, so the deploy picks this up.
const ASSET_URL_BASE = (process.env.ASSET_BASE_URL || '/assets').replace(/\/+$/, '');

/**
 * Curated category metadata. `folder` maps to a directory in the asset library.
 * `card` marks the categories that appear as circular cards on the homepage.
 */
const CATEGORIES = [
  {
    slug: 'business-cards-stationery',
    folder: 'Business-Collateral',
    title: 'Business Cards & Stationery',
    tagline: 'Cards, letterhead, folders, banners & brand kit',
    description:
      'Order business cards in four styles, plus letterhead, cobranded folders, social banners, and the United Mortgage brand kit.',
    card: true,
    requestForm: true,
    image: 'Site-Design/Business-Cards.jpg',
  },
  {
    slug: 'program-flyers',
    folder: 'Program-Flyers',
    title: 'Program Flyers',
    tagline: 'Loan program one-sheets, generic & cobranded',
    description:
      'Downloadable flyers for every loan program — FTHB, VA, DSCR, ITIN, Non-QM, 2-1 Buydown, Renovation, Refi, Reverse, Second Mortgage, and state DPA programs. Available in Classic, Color-Pop, and Illustration styles.',
    card: true,
    image: 'Site-Design/Special-Programs-Flyer__featured-Image.png',
  },
  {
    slug: 'program-videos',
    folder: 'Program-Videos',
    title: 'Program Videos',
    tagline: 'Short explainer videos, English & Spanish',
    description:
      'Ready-to-share program explainer videos in English and Spanish, covering 2-Family, VA, DSCR, ITIN, Bank Statement, P&L, No Down Payment, 2-1 Buydown, and Renovation programs.',
    card: true,
    image: 'Site-Design/DSCR-Program_featured-Image-1.png',
  },
  {
    slug: 'social-media',
    folder: 'Social-Media',
    title: 'Social Media',
    tagline: 'Program posts, holidays, testimonials & reels',
    description:
      'Social graphics and reels: program posts, holiday content, new-hire and team spotlights, testimonials, and seasonal campaigns.',
    card: true,
    image: 'Site-Design/Social-Media.jpg',
  },
  {
    slug: 'open-house-promotion',
    folder: 'Open-House',
    title: 'Open House Promotion',
    tagline: 'Open house flyers, signage & video templates',
    description:
      'Everything for an open house: flyer styles, visitor sign-in sheet, and animated "This Home is For Sale" video templates.',
    card: true,
    image: 'Site-Design/Open-House.jpg',
  },
  {
    slug: 'closing-posts',
    folder: 'Closing-Posts',
    title: 'Closing Posts',
    tagline: 'Celebrate closings with branded video posts',
    description:
      'Video templates to celebrate a closing — polaroid, collage, map, and listing-photo styles ready to personalize.',
    card: true,
    image: 'Closing-Posts/Listing-Photo_Featured-Image.png',
  },
  {
    slug: 'postcards-mailers',
    folder: 'Marketing',
    title: 'Postcards, Door Hangers & Brochures',
    tagline: 'EDDM postcards, door hangers, brochures & flyers',
    description:
      'Direct-mail and door-to-door pieces: cobranded postcards, door hangers in three styles, the Direct Lender brochure, Loanopoly, and Rent-vs-Own flyers.',
    card: true,
    image: 'Marketing/Home-For-Sale-Cobrand-postcard_Style-01.png',
  },
  {
    slug: 'branding-signage',
    folder: 'Branding-and-Signage',
    title: 'Branding & Signage',
    tagline: 'Retractable banners & yard signs',
    description:
      'Large-format branding for events and listings — retractable banners and yard signs.',
    card: true,
    image: 'Site-Design/Branding-Signanges.jpg',
  },
  {
    slug: 'event-promotion',
    folder: 'Event-Promotion',
    title: 'Event Promotion',
    tagline: 'Event flyers & promotional graphics',
    description: 'Flyers and graphics to promote United Mortgage events.',
    card: false,
    image: 'Event-Promotion/Example-graphics-scaled.jpg',
  },
];

// Site-Design holds purpose-built "Featured-Image" previews for many flyer/program
// items that otherwise ship only as PDFs. We index these and match them to items
// by leading-token overlap so PDF-only items still get a real thumbnail.
const FEATURED_DIR = 'Site-Design';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm']);
const DOC_EXT = new Set(['.pdf', '.docx', '.doc']);

function fileType(ext) {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (ext === '.pdf') return 'pdf';
  if (DOC_EXT.has(ext)) return 'doc';
  return 'file';
}

// Tokens stripped (repeatedly, in order) from a base name to derive the item key.
const STRIP_PATTERNS = [
  /-scaled$/i,
  /_scaled$/i,
  /[-_]?featured[-_]image(?:-\d+)?$/i,
  /[-_]?hook[-_]image$/i,
  /[-_]page[-_]?\d+$/i,
  /1rltr$/i,
  /_generic_(classic|color-pop|illustration)$/i,
  /_cobrand_(classic|color-pop|illustration)$/i,
  /_cobrand_style-\d+$/i,
  /[-_]style-\d+$/i,
  /[-_](classic|color-pop|illustration)$/i,
  /[-_](english|spanish)$/i,
  /[-_](generic|cobrand)$/i,
  /[-_]\d{1,2}$/,
];

function normalizeItemKey(base) {
  let key = base;
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of STRIP_PATTERNS) {
      if (p.test(key)) {
        key = key.replace(p, '');
        changed = true;
      }
    }
  }
  return key.replace(/[-_]+$/g, '').trim() || base;
}

function humanize(str) {
  return str
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bFTHB\b/gi, 'FTHB')
    .replace(/\bDSCR\b/gi, 'DSCR')
    .replace(/\bITIN\b/gi, 'ITIN')
    .replace(/\bVA\b/gi, 'VA')
    .replace(/\bDPA\b/gi, 'DPA')
    .replace(/\bEDDM\b/gi, 'EDDM')
    .replace(/\bNJHMFA\b/gi, 'NJHMFA')
    .replace(/\bLO(s)?\b/g, 'LO$1')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Derive a human label + metadata for a single download from its filename.
function describeFile(base) {
  const lower = base.toLowerCase();
  const meta = { style: null, brand: null, lang: null };

  if (/color-pop/.test(lower)) meta.style = 'Color-Pop';
  else if (/illustration/.test(lower)) meta.style = 'Illustration';
  else if (/classic/.test(lower)) meta.style = 'Classic';
  else if (/minimalist/.test(lower)) meta.style = 'Minimalist';
  else if (/collage/.test(lower)) meta.style = 'Collage';

  const styleMatch = lower.match(/style-(\d+)/);
  if (styleMatch && !meta.style) meta.style = `Style ${styleMatch[1]}`;

  if (/cobrand/.test(lower)) meta.brand = 'Cobranded';
  else if (/generic/.test(lower)) meta.brand = 'Generic';

  if (/[-_]spanish\b/.test(lower) || /spanish/.test(lower)) meta.lang = 'Spanish';
  else if (/[-_]english\b/.test(lower) || /english/.test(lower)) meta.lang = 'English';

  const parts = [];
  if (meta.brand) parts.push(meta.brand);
  if (meta.style) parts.push(meta.style);
  if (meta.lang) parts.push(meta.lang);
  const label = parts.length ? parts.join(' · ') : 'Download';
  return { label, ...meta };
}

// Prefer an image as the item thumbnail; fall back to a PDF-less placeholder.
function pickThumbnail(files) {
  const img = files.find((f) => f.type === 'image');
  if (img) return img.url;
  const vid = files.find((f) => f.type === 'video');
  if (vid) return null; // videos handled with a poster/placeholder in the UI
  return null;
}

// Build an index of Site-Design featured images: normalized-token-set → url.
async function buildFeaturedIndex() {
  const dir = path.join(ASSETS_DIR, FEATURED_DIR);
  const index = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return index;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    const base = path.basename(e.name, ext);
    const key = normalizeItemKey(base.replace(/featured|image|hook/gi, ''));
    index.push({
      tokens: tokenSet(key),
      url: `${ASSET_URL_BASE}/${encodeURIComponent(FEATURED_DIR)}/${encodeURIComponent(e.name)}`,
    });
  }
  return index;
}

function tokenSet(str) {
  return new Set(
    str
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1)
  );
}

// Match an item to the featured image sharing the most tokens (need >= 2 overlap).
function matchFeatured(itemKey, featuredIndex) {
  const itemTokens = tokenSet(itemKey);
  let best = null;
  let bestScore = 0;
  for (const f of featuredIndex) {
    let score = 0;
    for (const t of itemTokens) if (f.tokens.has(t)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return bestScore >= 2 ? best.url : null;
}

async function scanCategory(cat, featuredIndex) {
  const dir = path.join(ASSETS_DIR, cat.folder);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { ...cat, items: [], fileCount: 0 };
  }

  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const itemMap = new Map();

  for (const name of files) {
    const ext = path.extname(name).toLowerCase();
    const base = path.basename(name, ext);
    const key = normalizeItemKey(base);
    const url = `${ASSET_URL_BASE}/${encodeURIComponent(cat.folder)}/${encodeURIComponent(name)}`;
    const desc = describeFile(base);

    if (!itemMap.has(key)) {
      // Some source files are named numerically (e.g. "01.jpg", "1.png"). Give
      // these a readable, category-scoped title instead of a bare number.
      const numeric = /^\d+$/.test(key.trim());
      const title = numeric ? `${singular(cat.title)} — Design ${Number(key)}` : humanize(key);
      itemMap.set(key, {
        slug: numeric ? slugify(`${cat.slug}-${key}`) : slugify(key),
        title,
        files: [],
      });
    }
    itemMap.get(key).files.push({
      name,
      label: desc.label,
      url,
      type: fileType(ext),
      ext: ext.replace('.', ''),
      style: desc.style,
      brand: desc.brand,
      lang: desc.lang,
    });
  }

  const items = [...itemMap.values()].map((item) => {
    // Sort downloads: Generic before Cobranded, Classic/Color-Pop/Illustration order, English before Spanish.
    item.files.sort(byDownloadOrder);
    // Thumbnail: an in-item image first, else a matching Site-Design featured image.
    item.thumbnail = pickThumbnail(item.files) || matchFeatured(item.title, featuredIndex);
    item.types = [...new Set(item.files.map((f) => f.type))];
    return item;
  });

  items.sort((a, b) => a.title.localeCompare(b.title));

  return {
    slug: cat.slug,
    folder: cat.folder,
    title: cat.title,
    tagline: cat.tagline,
    description: cat.description,
    card: cat.card,
    requestForm: cat.requestForm || false,
    image: cat.image ? `${ASSET_URL_BASE}/${cat.image.split('/').map(encodeURIComponent).join('/')}` : null,
    items,
    fileCount: files.length,
    itemCount: items.length,
  };
}

const STYLE_ORDER = { Classic: 0, 'Color-Pop': 1, Illustration: 2, Minimalist: 3 };
function byDownloadOrder(a, b) {
  const brandA = a.brand === 'Cobranded' ? 1 : 0;
  const brandB = b.brand === 'Cobranded' ? 1 : 0;
  if (brandA !== brandB) return brandA - brandB;
  const sa = STYLE_ORDER[a.style] ?? 9;
  const sb = STYLE_ORDER[b.style] ?? 9;
  if (sa !== sb) return sa - sb;
  const langA = a.lang === 'Spanish' ? 1 : 0;
  const langB = b.lang === 'Spanish' ? 1 : 0;
  if (langA !== langB) return langA - langB;
  return a.name.localeCompare(b.name);
}

// Rough singularizer for category titles used in generated item names.
function singular(title) {
  const first = title.split(/[,&]/)[0].trim();
  return first
    .replace(/\bFlyers\b/, 'Flyer')
    .replace(/\bVideos\b/, 'Video')
    .replace(/\bPosts\b/, 'Post')
    .replace(/\bCards\b/, 'Card')
    .replace(/ies$/, 'y')
    .replace(/s$/, '');
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const featuredIndex = await buildFeaturedIndex();
  const categories = [];
  for (const cat of CATEGORIES) {
    categories.push(await scanCategory(cat, featuredIndex));
  }

  const totals = categories.reduce(
    (acc, c) => {
      acc.files += c.fileCount;
      acc.items += c.itemCount;
      return acc;
    },
    { files: 0, items: 0 }
  );

  const catalog = {
    generatedAt: new Date().toISOString(),
    site: {
      name: 'United Marketing Desk',
      org: 'United Mortgage Corp',
      domain: 'marketing.unitedmortgage.com',
      email: 'marketing@unitedmortgage.com',
      requestEmail: 'marketingdesk@unitedmortgage.com',
      phone: '516-212-0299',
    },
    totals,
    categories,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(catalog, null, 2));
  console.log(
    `[catalog] ${categories.length} categories · ${totals.items} items · ${totals.files} files → ${path.relative(ROOT, OUT_FILE)}`
  );
}

main().catch((err) => {
  console.error('[catalog] build failed:', err);
  process.exit(1);
});
