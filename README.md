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
* **Admin dashboard** (`/admin/`, admins and editors only):
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

## Requested on Oct 29, to schedule (proposed for a Nov 1 session)

* **Layout confirmed by the user:**
  * A short intro at the top: 2–3 sentences, about 350 characters max, with a "Read the full guide ↓" link.
  * Lengthy SEO content at the bottom, below the listings and above the FAQs. It supports headings with an automatic table of contents, links and images.
* **Page content editor (admin)** for city, state, category and city + category pages:
  * Fields: custom intro (above the listings), long-form guide content (below), custom FAQs, SEO title/description overrides, hero image.
  * Empty fields fall back to the auto-generated text.
  * A list of all pages, filterable by "has custom content" and sortable by traffic.
  * Bulk import from CSV.
* **Database-backed filters** across all vendors in a city, with shareable filter URLs that canonicalise to the main page. Sub-category pages, e.g. "Barn venues in Austin".
* **GEO/AEO additions:**
  * robots.txt rules for AI crawlers, plus `llms.txt`;
  * a direct-answer summary block on listing pages;
  * visible "Last updated" dates (dateModified);
  * Organization and author markup;
  * hreflang for US/CA/UK/AU, IndexNow, and share images.

## Blog (public, Oct 31)

* `/blog/`, `/blog/category/<slug>/` (empty categories are not built) and `/blog/page/N/` (12 posts per page).
* Post pages: breadcrumb, cover image, table of contents (3+ headings), author, reading time, "Updated" date, BlogPosting + Breadcrumb schema, related posts, and a call to action to the linked city/category listing.
* Comments: approved comments are in the static HTML, with one level of replies and a team badge on staff replies. The form posts to `submit_comment`; new comments wait for moderation.
* "Planning guides" on city pages and city + category pages, from posts linked to that city/category in the editor.
* `/blog/rss.xml`, blog links in the header and footer, and blog URLs in the sitemap.

## Hosting build (Oct 31)

* **URL format: kept as directory pages with trailing slashes** (`/us/texas/austin/`). Switching to one file per page would change every URL and need rewrite rules. The inode saving is instead made by not pre-building thin profiles (below), which cut the file count far more.
* **Basic listings** (unclaimed and no description, photos, packages or reviews, typically from the open-data import) have no built page. They link to one shared page, `/vendor/?v=<slug>`, which loads the details in the browser, is `noindex`, stays out of the sitemap, and still takes quote requests. When a vendor claims or fills in a listing, the next build gives it a full page, and the shared page redirects to it.
* **Sitemap index**: `/sitemap.xml` lists `/sitemap-1.xml`, `/sitemap-2.xml`… with up to 45,000 URLs each.
* `web/public/.htaccess`: https redirect, 404 page, long caching for `/_astro/` files, compression, security headers.

## Automatic jobs (GitHub Actions)

| Job | When | Needs |
|---|---|---|
| **Build and deploy** (`deploy.yml`) | every 3 hours, every push, or on demand | Upload: secrets `FTP_HOST`, `FTP_USER`, `FTP_PASS`; variables `SITE_URL`, `SITE_NAME`, `CONTACT_EMAIL`, optional `FTP_DIR` (default `public_html/`). Without FTP secrets it only builds and type checks. Only changed files are uploaded. |
| **Weekly backup** (`backup.yml`) | Sundays, or on demand | secret `SUPABASE_DB_URL`. The dump is kept 60 days as a run artifact. |
| **Import vendors** (`import-vendors.yml`) | on demand | secret `SUPABASE_DB_URL`. Optional "visit vendor websites" step (see below). |

## Emails (migration 012)

* Sent from the database by `pg_cron` every minute through `pg_net` to **Resend** (free tier: 3,000 emails a month). There's no separate server.
* Lead emails go to vendors with the couple as reply-to. Unclaimed vendors get a "claim your listing" link. Also sent: vendor replies to couples, a 24-hour no-reply reminder (hourly job), and claim decisions.
* Failed sends retry up to 5 times. Until a Resend key exists, emails wait in the queue.
* To switch on (SQL editor, once): `select vault.create_secret('<resend key>', 'resend_api_key');` then set `email_from` and `site_url` in `settings`. Verify the sending domain in Resend first.
* A daily job rolls click/view events older than 120 days into daily totals (`event_daily`).

## Website enricher (`scripts/scraper/enrich.mjs`)

* Takes a CSV with a `website` column (e.g. the import's `vendors.csv`) and reads each vendor's own site to add phone, email, address, ZIP, starting price and capacity. It also adds a short `site_summary` for you to review; this is never imported.
* Obeys robots.txt, identifies itself as BloomvowBot, waits between requests to the same site, reads at most 5 pages per site, and never copies reviews, testimonials or photos. It only fills blank fields.
* Run it locally (`node scripts/scraper/enrich.mjs vendors.csv enriched.csv`), then import in Admin › Vendors › Import CSV. Or tick "visit vendor websites" in the Import vendors job.

## Photos

* Photos are shrunk in the browser before upload: longest side 1600px (blog covers 2000px), WebP, about 80% quality (JPEG on browsers that can't make WebP). Originals up to 25 MB are accepted.

## Real vendor data (Overture Maps)

* Source: [Overture Maps](https://overturemaps.org) places, open data under CDLA-Permissive-2.0 (commercial use allowed). Google Maps, Yelp and The Knot are not used: their terms forbid copying listings.
* Run it: GitHub > Actions > **Import vendors** > Run workflow. Keep **dry run** ticked first; download `vendors-csv` from the run to check the data. Then run again with dry run unticked.
* Rules: open businesses only, confidence 0.6+, within 35 km of a launch city, mapped to our 15 categories (`scripts/vendors/categories.py`; broad types such as bakeries or salons need a wedding word in the name). Duplicates merge; nothing is overwritten. Imported rows have `source = 'overture'`, so a batch can be removed with `delete from vendors where source = 'overture' and status = 'unclaimed';`.
* Needs the GitHub secret `SUPABASE_DB_URL`: Supabase > Connect > **Session pooler** connection string, with your database password filled in. GitHub's servers can't use the direct connection.
* Footer credit to add: "Business data includes Overture Maps Foundation open data."

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
npm run test:db     # 39 database tests: permissions, routing, claims, import, stats, photos, onboarding
npm run test:unit   # front-end logic (filters, search, quote flow) + website enricher
npm run test:e2e    # needs POSTGREST_BIN + AUTH_BIN: builds the whole site and drives a real browser
                    # through every public and vendor-dashboard flow (36 tests: public site, blog, vendor and admin dashboards)
```

## Notes for deployment (Oct 31)

* Vendor edits save instantly to the database. The static public pages need a rebuild to show them, so a scheduled build (planned every 30 minutes) will publish changes.
* Run the migrations in `db/migrations/` in order in the Supabase SQL editor. `005` creates the `vendor-photos` storage bucket.
* In Supabase Auth settings, set the Site URL to the live domain so email links point to the right place.

## Live Supabase project (status Oct 30)

* Applied: 001–006, 006b (editor role), 007 (blog tables and views), 007b (comment functions and image bucket), 008 (advisor hardening), 008b, 009 (countries + regions), 010 + 010b (per-country categories), 011 (scheduled jobs may run admin imports), 007c + 007d (blog category delete, editors can delete blog images).
* Pending: 012 (emails + scheduled jobs). Its approval prompt timed out on Oct 31. Also schedule its jobs (the end of `012_email_and_jobs.sql`) once it's applied.
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
