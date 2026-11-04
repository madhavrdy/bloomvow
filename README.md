# Bloomvow: wedding vendor directory

US wedding vendor directory (venues, photographers, hair & makeup, caterers and
11 more categories), built to expand to Canada, the UK and Australia.

* **Public site**: Astro, fully static, fast. It deploys to Hostinger as plain files.
* **Backend**: Supabase (Postgres database, logins, file storage). All business
  rules (lead routing, permissions, claims, imports, stats) live in the database
  as SQL functions and row-level security, and they are covered by automated tests.
* **Vendor dashboard** (`/vendor-dashboard/`):
  * sign-up and sign-in (password, email link or password reset);
  * claim a listing, or add a new business that goes live after admin approval;
  * overview stats, a lead inbox with quick replies and statuses;
  * listing editor: details, packages, service-area cities with plan limits, photos up to 30.
* **Admin dashboard** (`/back-end/`, admins and editors only):
  * overview stats (leads, clicks, views, reply rate, attention list) and leads with routing log, re-route and spam;
  * vendors: edit, plan and status, claims queue, CSV import with duplicate merging;
  * review moderation;
  * cities and vendor categories: add, edit, reorder, hide, URL lock; countries on/off;
  * per-country categories: switch any category off in one country only (e.g. Officiants in India). Its vendors and pages drop out of that country, and couples there can't request it;
  * blog posts: Markdown editor, live preview, schedule/publish, cover image, "planning guide" links;
  * blog categories: create, rename, reorder, hide, delete after moving posts;
  * comment moderation: bulk approve/reject/spam, staff replies;
  * team roles: editor = blog only.

## Planned for the admin dashboard (Oct 30)

* **Cities & categories screen**: add, edit, reorder and hide categories. Fields: name, singular, URL slug, sort order, budget share, whether guest capacity applies, and shown/hidden. The same screen manages cities and switches on new countries.
  * A category with vendors is hidden, not deleted.
  * The slug locks once pages are live, so links don't break.
* The database side is already in place and tested (`categories` table, admin-only writes).
* **Blog with comments** (requested Oct 29):
  * Oct 30, database + admin: posts written in Markdown with a live preview, cover image, draft/scheduled/published, SEO fields, and links to a city or vendor category. The comment moderation queue offers approve/reject/spam, bulk actions and admin replies.
  * Oct 31, public pages: `/blog/` with categories, post pages, threaded comments, related posts, "Planning guides" on matching city pages, an RSS feed and Article schema.
  * All comments are held for moderation, with spam protection.

## Multi-country (added Oct 30)

* Countries in the database: US (live) plus Canada, UK, Australia, India, New Zealand and Ireland, all switched off. Every country has its states/regions loaded.
* Admin > Cities & categories can add any new country (code + currency), states/regions and cities, and switch a country on.
* URLs: `/<country>/<region>/<city>/<category>/`, e.g. `/in/karnataka/bengaluru/wedding-venues/`.
* **Before switching on a non-US country** (planned for Nov 1):
  * prices shown in the country's currency;
  * budget bands per country (INR bands differ from USD);
  * hreflang tags between countries;
  * localised words (postcode / PIN code vs ZIP).

## Page content, filters and GEO/AEO (Nov 1)

* **Page content editor** (Admin › Page content; admins and editors):
  * Covers every state, city, category, city + category and style page.
  * **Short intro** at the top: a 350-character target with a warning past it (600 max). A "Read the full guide ↓" link appears when there's a guide.
  * **Long guide** at the bottom, below the listings and above the FAQs. It's Markdown with headings that build an automatic table of contents, plus links, images and lists, with a live preview.
  * **Custom FAQs**: shown first, merged with the automatic ones, and included in the FAQ schema.
  * **SEO title and description overrides**, and a **hero image** (upload or URL).
  * Empty fields fall back to the automatic text.
  * Page list: search, type filter, "has custom content" filter, sort by 30-day visits or vendor count, and bulk **CSV import** (`path, intro, body, seo_title, seo_description, hero_url, hero_alt, faqs` with FAQs as `Q | A || Q2 | A2`).
  * Stored in `page_content`, keyed by URL path.
* **Database-backed filters**:
  * When every vendor is on the page, filters run in the browser. On bigger listings (more than one page), a filter or sort queries `search_vendors()` across the whole city + category, including service-area vendors, with "Show more".
  * Filters are kept in the URL (`?guests=201&price=0-4000&sort=price`), so filtered views can be shared; the canonical stays the plain page.
* **Style sub-pages**: e.g. `/us/texas/austin/wedding-venues/barn/` for Barn & ranch, Outdoor, Garden, Vineyard & winery, Ballroom & hotel, Loft & industrial, Waterfront, and Historic & estate. A page is built only when a city has 5 or more matching venues. They're linked from the listing and included in the sitemap.
* **GEO / AEO**:
  * `robots.txt` explicitly welcomes GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended and others. There's an `/llms.txt` site map for AI assistants.
  * "At a glance" factual summary on listing pages, a visible "Last updated" date, and CollectionPage `dateModified`.
  * Organization + WebSite schema on the homepage. `sameAs` comes from `PUBLIC_SOCIAL_LINKS`, a comma-separated list of your social profile URLs.
  * Blog author pages (`/blog/author/<name>/`) with Person schema, linked from posts.
  * hreflang: `en-us` on US pages, plus x-default and one link per live country on the homepage. New countries are added automatically when switched on.
  * Per-page share images: the hero image or first vendor photo, else `og-default.png`. Regenerate it with your brand: `PUBLIC_SITE_NAME="Brand" node scripts/og-image.mjs`.
  * IndexNow: the key file is in `web/public/`, and `scripts/indexnow.mjs` runs after each deploy to ping changed URLs.
  * Page views of content pages are counted (`page_view` events), which drives "sort by traffic".

## Folder layout

```
db/migrations/     Database schema, security rules and business logic (run in order on Supabase)
db/seed/           Generator for FICTIONAL sample data (local testing only)
db/test/           Database tests (security, lead routing, import, stats)
web/               Astro site
web/src/pages/     Page templates (home, state, city, city+category listing, vendor profile, get matched...)
web/src/scripts/   Small browser scripts (lead forms, filters, search, shortlist, tracking)
web/tests/         Unit tests + browser end-to-end tests
scripts/           Local Supabase stand-in (PostgREST gateway) and the end-to-end test runner
```

## URL structure

| Page | Example |
|---|---|
| Country | `/us/` |
| State | `/us/texas/` |
| City hub | `/us/texas/austin/` |
| City + category (main SEO page) | `/us/texas/austin/wedding-venues/` (`/page/2/` beyond 60 vendors) |
| Category hub | `/categories/wedding-venues/` |
| Vendor profile | `/vendor/cedar-hollow-ranch-austin/` |
| Lead flow | `/get-matched/` |

City + category pages with fewer than 5 vendors (setting `min_vendors_to_index`)
are built but marked `noindex` and left out of the sitemap, so thin pages don't
hurt the whole site's ranking.

## How leads are routed (`submit_lead` in `db/migrations/003_functions.sql`)

1. **Profile form**: goes to that vendor, plus up to 3 similar vendors if the couple leaves the box ticked.
2. **Get matched**: up to 3 vendors per chosen category.
3. **Request pricing from several** (listing page): up to 8 vendors in one category.

Vendors must serve the city (or a city within 60 km), fit the guest count
(venues and caterers) and have a starting price within the couple's budget
share for that category. Featured vendors come first, then same-city, claimed,
best rated. Each recipient gets an email queued in `notifications`. Leads with
no reply after 24h trigger a reminder. Spam protection: hidden honeypot field
and 5 requests per email per hour.

## Running locally

Needs Node 22, Postgres 16, and two Supabase server binaries from GitHub releases:
PostgREST (v12.2.3, `postgrest-v12.2.3-linux-static-x64.tar.xz`) and Supabase Auth
(v2.180.0, `auth-v2.180.0-x86.tar.gz`).

```bash
npm install && (cd web && npm install)
export POSTGREST_BIN=/path/to/postgrest AUTH_BIN=/path/to/auth
npm run db:reset                 # local database + fictional sample data + dev logins
npm run dev:api                  # local Supabase stand-in on :54321 (database API, logins, photo storage)
cp web/.env.example web/.env     # PUBLIC_SUPABASE_URL=http://localhost:54321 + the anon key printed above
cd web && npm run dev
```

Local dev logins (password `password123`): `admin@bloomvow.local` (admin), `dana@vendor.local` (vendor with a Featured listing).

## Tests

```bash
npm run test:db     # 42 database tests: permissions, routing, claims, import, stats, photos, onboarding
npm run test:unit   # front-end logic (filters, search, quote flow) + website enricher
npm run test:e2e    # needs POSTGREST_BIN + AUTH_BIN: builds the whole site and drives a real browser
                    # through every public and vendor-dashboard flow (44 tests: public site, blog, content & filters, vendor and admin dashboards)
```

## Notes for deployment (Oct 31)

* Vendor edits save instantly to the database. The static public pages need a rebuild to show them, so a scheduled build (planned every 30 minutes) will publish changes.
* Run the migrations in `db/migrations/` in order in the Supabase SQL editor. `005` creates the `vendor-photos` storage bucket.
* In Supabase Auth settings, set the Site URL to the live domain so email links point to the right place.

## Live Supabase project (status Oct 30)

* Applied: 001–006, 006b (editor role), 007 (blog tables and views), 007b (comment functions and image bucket), 008 (advisor hardening), 008b, 009 (countries + regions), 010 + 010b (per-country categories), 011 (scheduled jobs may run admin imports), 007c + 007d (blog category delete, editors can delete blog images).
* Applied Nov 1: 013 (page content, page views, search).
* Pending: 012 (emails + scheduled jobs). Its approval prompt timed out on Oct 31. Once it's applied, also run the schedules at the end of `012_email_and_jobs.sql`.
* Known advisor items:
  * public_* views are SECURITY DEFINER by design: they expose safe columns only. Plan to convert them to invoker views with column grants on Nov 1.
  * Default EXECUTE grants on admin functions are harmless, because each checks require_admin().

## Live Supabase project

* Project **Wed-directory** (ref `mpxvxcajkaaocrozljtc`, region us-east-1, Postgres 17, Free plan). Its public URL and publishable key are in `web/.env.production`.
* Connected through the Supabase connector on Oct 29. The database is still empty.
* Production migrations (`db/migrations/*`, never `db/test/*` or `db/seed/*`) are applied in the Oct 30 session, then checked with Supabase's advisors.

## Fitting Supabase's free plan (checked Oct 29)

The free plan allows a 500 MB database, 1 GB of file storage and 5 GB of downloads a month. It has no backups and pauses after 1 week of inactivity.

To add for Oct 31:
* **Shrink photos in the browser before upload** to about 1600 px WebP (roughly 150 KB).
* **Pull only changed data in each scheduled build**, and build every few hours rather than every 30 minutes at scale.
* **Summarise old click and view events** into daily totals.
* **Weekly database backup** through GitHub Actions (pg_dump) while on the free plan.
* **Lead and reply emails through Resend** (free tier), not Supabase's built-in email, which is meant for login emails only.

## Before launch

* Delete sample data: `delete from vendors where source = 'sample';`
* Replace the placeholders: brand name (`PUBLIC_SITE_NAME`), Featured plan price, privacy policy, terms.
