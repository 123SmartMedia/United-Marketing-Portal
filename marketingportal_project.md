# United Marketing Desk Rebuild Plan
**Recreating unitedmarketingdesk.com as a subdomain of unitedmortgage.com**
Prepared for Michael Cabales · United Mortgage Marketing Re-Launch · July 21, 2026

---

## 1. Goal

Replace the current unitedmarketingdesk.com — built and hosted by Ocu Agency on a domain United Mortgage does not control — with a functionally identical marketing hub that United Mortgage fully owns, running at **marketing.unitedmortgage.com** (recommended; alternatives: desk.unitedmortgage.com, hub.unitedmortgage.com). Phase 1 is a like-for-like duplicate so the cutover is low-risk; improvements (Total Expert integration, gated access, request tracking) come afterward as Phase 2, keeping progress linear.

## 2. What the current site actually is (audit findings)

The site is a WordPress installation using the **Avada theme with Fusion Builder**, plus **Yoast SEO**, **WP Download Manager Pro** (for downloadable assets), and **WooCommerce** (used for the merch shop and at least one flyer listed as a product). There is no login or password gating anywhere — all assets are publicly downloadable. Ordering of printed materials (business cards, banners, folders, etc.) is not e-commerce: it works through embedded request forms that email **marketingdesk@unitedmortgage.com**. Site-wide contact points are marketing@unitedmortgage.com and 516-212-0299.

Ownership note that shapes the approach: the *content* (flyers, videos, social graphics, brand identity, contact info) is United Mortgage's own marketing material, so recreating it on your subdomain is clean. The *theme, page-builder templates, and site code* belong to the Avada license holder and Ocu Agency, so we rebuild the site from scratch to look and behave the same rather than copying their files. This is also simply the better path technically — the Avada/WordPress stack is heavy, and a rebuilt site will be faster.

### Complete page inventory (from the site's own sitemaps)

| Page | URL slug | Function |
|---|---|---|
| Homepage | / | Category grid (8 circular category cards), featured items, Get Started CTA |
| Get Started | /get-started/ | Onboarding for new loan officers |
| Get Started with United | /get-started-with-united/ | Recruiting/onboarding variant |
| Business Cards & Stationery | /business-cards-stationery/ | 4 card styles (Headshot, No Photo, Profile, Shield); request form; letterhead, brand kit, webpages, LinkedIn banner links |
| Premium Prints | /premium-prints/ | Premium business cards, door hangers |
| Brochures | /brochures/ | Direct Lender brochure etc. |
| Folders | /folders/ | United + cobranded folders |
| Event Promotion | /event-promotion/ | Event flyers |
| Open House Promotion | /open-house-promotion/ | Open house flyers/signage |
| Postcards & EDDM Campaigns | /post-cards-eddm-campaigns/ | Postcards, EDDM mailing campaigns |
| Program Flyers | /program-flyers/ | 15+ flyers: FTHB, VA, General Overview, DSCR, ITIN, Non-QM Overview, 2-1 Buy Down, Renovation, Cash-out Refi, Rate & Term Refi, Reverse Mortgage, Second Mortgage, DPAL-PA (K-FIT), Essex DPA, NJHMFA, NY DPA |
| Other Flyers | /other-flyers/ | Loanopoly, Rent vs Own, Lender's Credit, etc. |
| Program Videos | /program-videos/ | 2-Family, VA, DSCR, ITIN, Bank Statement, P&L, No Down Payment, 2-1 Buydown, Renovation |
| Program Posts | /program-posts/ | Social carousel/static posts per program |
| Social Media | /social-media/ | Closing posts, testimonials, new hire, team spotlight, news, holiday posts (New Year, Mother's Day, 4th of July, Thanksgiving, Christmas), reels |
| United Studio | /united-studio/ | Studio/creative services overview |
| Custom Requests | /custom-requests/ | Special request form |
| Form | /form/ | Standalone request form |
| Weekly Report | /united-mortgage-weekly-report/ | United Mortgage weekly report |
| Leads | /leads/ | "Homebuyer Campaign" paid lead-gen service ($15/lead, $1,500/mo min) — **see open questions** |
| Merch | /merch/ + /shop/, /cart/, /checkout/, /my-account/ | WooCommerce apparel shop (hoodies, sweatshirts, hats — print-on-demand style catalog) — **see open questions** |
| Demo | /demo/ | Appears to be a test page — likely exclude |

Also present in navigation (built as sections/templates rather than standalone sitemap pages): Branding & Signage (retractable banners, yard signs), Cobranding, Brand Kit, Letterhead, Landing Page, LinkedIn Banner, Door Hangers.

## 3. Target architecture

Per your platform choice, the new site will be a **custom modern build**: Next.js (static-first) deployed on Vercel free/pro tier, with the site's entire catalog — every category, item, thumbnail, and download — stored as structured content (JSON/MDX files in the repo) rather than hard-coded into pages. This is the future-proofing move: when Total Expert enters in Phase 2, the same catalog data can drive Total Expert asset syncing, and adding/updating an asset is a one-file change instead of a page edit. The repo lives in a United Mortgage-owned GitHub account, so you own 100% of the code and content from day one.

Functional parity mapping:

| Current (WordPress) | New build |
|---|---|
| Avada page layouts | Custom React components styled to match the current look (colors, circular category grid, card layouts) |
| WP Download Manager downloads | Static asset hosting with download buttons (same one-click, no-login behavior); assets organized in a versioned /assets library |
| Email request forms | Forms posting through a serverless function → email to marketingdesk@unitedmortgage.com (via Resend or SendGrid), with a hidden abstraction layer so the same submissions can later also post to Total Expert/CRM without rebuilding the forms |
| Header search | Client-side search across the catalog (instant, no plugin needed) |
| Yoast SEO | Built-in metadata per page; the site can also be set to noindex if you'd rather keep it quasi-internal |
| WooCommerce merch shop | Decision needed — see §6 |

## 4. Phased execution plan

**Phase 0 — Access and asset capture (week 1).** Confirm the subdomain name and who adds the DNS record. Inventory and download every publicly available asset from the current site (flyers, videos, social graphics, thumbnails) into an organized library, flagging anything that's low-resolution or missing so you can source originals internally or request them from Ocu before any relationship change. Confirm which email inboxes should receive form submissions.

**Phase 1 — Build the duplicate (weeks 1–3).** Build all pages from the inventory above to visual and functional parity: homepage category grid, every category and program page, download library, request forms, search, mobile responsiveness, and the same contact info and social links. Deployed continuously to a private staging URL you can review from any device as it comes together.

**Phase 2 — QA and content verification (week 3).** Systematic pass: every download tested, every form submission confirmed to arrive at the right inbox, link check against the full inventory, mobile/desktop review, and a side-by-side comparison with the live site to confirm nothing was missed.

**Phase 3 — Launch (week 4).** You (or IT) add one DNS record — a CNAME for marketing.unitedmortgage.com — and the site goes live with automatic SSL. Announce the new URL to loan officers and update any internal bookmarks/links. If the old domain remains up during transition, run both briefly; once you're confident, notify Ocu per whatever your agreement requires.

**Phase 4 — Relaunch enhancements (post-launch, scoped separately).** This is where the Marketing Re-Launch goals layer in without disturbing the working site: Total Expert integration (asset sync, co-branding automation, form submissions creating TE contacts/tasks instead of just emails), optional login gating for LO-only materials, a request-tracking workflow so marketingdesk@ requests don't live only in an inbox, and download analytics so you can see which materials LOs actually use.

## 5. Costs

Hosting on Vercel: $0–20/month. Domain: none (subdomain of a domain you own). Email delivery for forms (Resend/SendGrid): free tier covers this volume. Total ongoing cost is effectively $0–20/month versus whatever is currently paid to Ocu for hosting/maintenance.

## 6. Decisions made & remaining open questions

**The merch shop — DECIDED (7/21/26):** Excluded from Phase 1. Will be added in a later phase once a United Mortgage-owned fulfillment account (e.g., Printful) is set up. The new site launches without /merch/, /shop/, /cart/, /checkout/, /my-account/.

**The Leads page — DECIDED (7/21/26):** Dropped entirely. United Mortgage sells no leads and has no affiliation with Ocu Agency's "Homebuyer Campaign" service. /leads/ will not be recreated.

**Asset quality.** Anything only available on the site as a compressed web version (especially videos) will carry that quality over. Worth checking whether the marketing team or Ocu can hand over source files for the most-used items.

**The demo page and duplicate get-started pages.** I'd exclude /demo/ and consolidate the two get-started pages unless you want strict 1:1 parity.

**Form inbox.** Assuming marketingdesk@unitedmortgage.com (matching the current site) unless Michael specifies otherwise.

**Subdomain.** Assuming marketing.unitedmortgage.com unless Michael specifies otherwise. DNS isn't needed until launch week.

## 7. Status log

- 7/21/26 — Site audited, full page inventory built from sitemaps, plan approved direction: custom modern build, duplicate-first. Merch deferred, Leads dropped (no Ocu affiliation).
- 7/21/26 — **Phase 0 asset inventory complete.** 314 cataloged entries across all 67 portfolio items + category pages: 225 files (PDFs/images), 59 videos (mp4, hosted on the site's own server), 24 Google Drive links, 5 request-form-only items. Manifest saved as `asset_manifest.csv` in the project.
- **Risk flagged:** ~24 downloads (all social carousel posts + most of the Brand Kit) point to Google Drive files rather than the website's server. If that Drive is Ocu-controlled, those assets disappear if the relationship changes — capture them first and host everything on the new site directly. Also note: the site's brand-kit PDF is `Brand-Guideline-08-2024.pdf` — confirm marketing has the editable source.
- **Next:** bulk-download the 284 site-hosted files + verify/capture the 24 Drive files, then start the Phase 1 build.
- 7/21/26 — Download script (`download_assets.py`, 283 files after excluding the Ocu leads video) delivered to Michael. **Local project home on Michael's PC: `C:\Projects\United Marketing Portal`** — assets will land in `UnitedMarketingDesk-Assets\` inside it. Michael to also save the 24 Google Drive files there, then connect the folder via the Claude desktop app for verification and the Phase 1 build.
- 7/22/26 — **Phase 1 built + deployed.** Custom Next.js 16 site (App Router, React 19, Tailwind v4). Entire catalog auto-generated from the asset library into structured JSON — 9 categories, 154 items, 247 files. Homepage circular category grid, per-category + per-item pages with one-click no-login downloads and style-variant preview, instant client-side search, Get Started + Custom Request forms. Repo at github.com/123SmartMedia/United-Marketing-Portal (auto-deploys to Vercel on push).
- 7/22/26 — **Assets → Cloudflare R2.** All 283 files (3.95GB) uploaded to a United-Mortgage-owned R2 bucket and served over CDN; site references them at runtime via env var. Resolves the flagged Google-Drive/Ocu risk — everything now hosted on infrastructure United owns.
- 7/22/26 — **Request forms wired to SendGrid** → send + receive at marketing@unitedmortgage.com (verified single sender). Live-tested end to end.
- 7/22/26 — **LAUNCHED at https://marketing.unitedmortgage.com** (Phase 3 cutover). CNAME → Vercel, automatic HTTPS (Let's Encrypt), all routes verified. Site is `noindex` (internal LO hub).
- **Remaining:** rotate the temporary R2 access keys; optional SendGrid full-domain authentication + Vercel deployment protection; announce URL to LOs and retire the old unitedmarketingdesk.com per the Ocu agreement. Phase 4 (Total Expert, login gating, request tracking, analytics) scoped separately.