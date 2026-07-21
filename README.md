# United Marketing Desk

Rebuild of **unitedmarketingdesk.com** as a United Mortgage–owned marketing hub,
targeting **marketing.unitedmortgage.com**. Phase 1 is a like-for-like duplicate:
a fast, custom Next.js site where the entire asset catalog lives as structured
content instead of hard-coded pages. See `marketingportal_project.md` for the full plan.

## Stack

- **Next.js 16** (App Router) + **React 19**, deployed static-first on Vercel
- **Tailwind CSS v4** for styling (navy + blue brand theme from the UM logo)
- Catalog generated from the asset library into `src/content/catalog.json`
- Request forms post to a serverless route (`/api/requests`) → email via Resend

## How it's wired

```
UnitedMarketingDesk-Assets/     3.7GB source asset library (git-ignored)
  Program-Flyers/ Program-Videos/ Social-Media/ ...
scripts/build-catalog.mjs       scans the library → src/content/catalog.json
public/assets                    directory junction → UnitedMarketingDesk-Assets
src/
  content/catalog.json           generated; drives every page
  lib/catalog.js                 catalog read helpers
  lib/submissions.js             form-delivery abstraction (email now, CRM later)
  app/                           routes (home, /browse, /category/[slug]/[item], forms)
  components/                    Header+search, cards, download list, request form
```

The catalog is **derived from filenames**: files sharing a base name are grouped
into one item, with variant labels (Classic / Color-Pop / Illustration,
Generic / Cobranded, English / Spanish) detected automatically. Category-level
titles, ordering, and homepage cards come from the curated `CATEGORIES` map in
`scripts/build-catalog.mjs`. **Adding an asset = drop the file in the right
folder and re-run `npm run catalog`.**

## Local development

```bash
npm install
# creates public/assets junction to the asset library (Windows):
#   (already created; recreate with)
#   New-Item -ItemType Junction -Path public/assets -Target ../UnitedMarketingDesk-Assets
npm run dev            # regenerates catalog, starts dev server on :3000
```

Copy `.env.example` → `.env.local`. Without `RESEND_API_KEY`, form submissions
are logged to the server console instead of emailed — the UX still works end to end.

## Building

```bash
npm run build         # regenerates catalog, builds 169 static pages + the form API
npm start
```

## Deployment notes (before launch)

- **Assets:** the 3.7GB library (3.3GB of it video) is git-ignored and served
  locally via the `public/assets` junction. For production, host the library on
  object storage / a CDN and point the catalog's `ASSET_URL_BASE` at it, or
  commit only the non-video assets and stream video from a bucket. Do **not**
  push 3.7GB to Vercel.
- **Email:** verify the `marketing.unitedmortgage.com` sender domain in Resend
  and set `RESEND_API_KEY` / `REQUEST_EMAIL` / `FROM_EMAIL` in Vercel env vars.
- **DNS:** add the `CNAME` for `marketing.unitedmortgage.com` at launch (Phase 3).
- The site is `noindex` by default (quasi-internal LO hub); flip in
  `src/app/layout.jsx` if public indexing is wanted.

## Scope (per plan §6)

Excluded from Phase 1 by decision (7/21/26): the **merch shop** (`/merch`,
`/shop`, `/cart`, `/checkout`, `/my-account`) and the **Leads** page. Total
Expert integration, login gating, and request tracking are Phase 4.
