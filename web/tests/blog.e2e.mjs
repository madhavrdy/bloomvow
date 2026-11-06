// Browser tests for the public blog and basic (open-data) vendor listings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = process.env.SITE;
const DIST = process.env.DIST;
const POST = '/blog/how-much-does-a-wedding-venue-cost-in-austin/';
let browser, db;
const q = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'] });
  db = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.DB });
  await db.connect();
});
after(async () => { await browser?.close(); await db?.end(); });

async function page() {
  const p = await (await browser.newContext()).newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  return p;
}
const html = (f) => fs.readFileSync(path.join(DIST, f), 'utf8');

test('blog index and category pages list live posts only, with nav links', async () => {
  const p = await page();
  await p.goto(`${SITE}/`);
  await p.click('header .nav a:has-text("Blog")');
  await p.waitForURL(/\/blog\/$/);
  assert.equal(await p.locator('.pcard').count(), 1, 'the draft is not listed');
  await p.click('.blog-cats a:has-text("Budget")');
  await p.waitForURL(/\/blog\/category\/budget\/$/);
  assert.equal(await p.locator('.pcard').count(), 1);
  assert.ok(!fs.existsSync(path.join(DIST, 'blog/questions-to-ask-your-photographer/index.html')), 'draft not built');
  assert.ok(!fs.existsSync(path.join(DIST, 'blog/category/photo-video/index.html')), 'empty categories not built');
  assert.deepEqual(p.errors, []);
});

test('post page: breadcrumb, TOC, schema, approved comments with staff reply, related CTA', async () => {
  const h = html('blog/how-much-does-a-wedding-venue-cost-in-austin/index.html');
  assert.match(h, /"@type":"BlogPosting"/);
  assert.match(h, /"@type":"BreadcrumbList"/);
  assert.match(h, /rel="alternate" type="application\/rss\+xml"/);
  assert.ok(!h.includes('Cheap Pills') && !h.includes('Do these prices include catering'), 'pending comments are not public');
  assert.ok(!h.includes('priya@example.com'), 'emails never public');
  const p = await page();
  await p.goto(`${SITE}${POST}`);
  assert.deepEqual(await p.locator('.crumbs li').allTextContents(), ['Home', 'Blog', 'Budget & costs', 'How much does a wedding venue cost in Austin?']);
  assert.equal(await p.locator('.toc li').count(), 3);
  await p.click('.toc a:has-text("How to save")');
  assert.match(p.url(), /#how-to-save$/);
  // The built page has the comments approved at build time; the live list adds any approved since.
  assert.equal((h.match(/class="cmt" id=/g) ?? []).length, 1);
  const [{ n }] = await q(`select count(*)::int n from comments c join posts p on p.id = c.post_id where p.slug = 'how-much-does-a-wedding-venue-cost-in-austin' and c.status = 'approved' and c.parent_id is null`);
  await p.waitForFunction((want) => document.querySelectorAll('#cmt-list > .cmt').length === want, n);
  assert.match(await p.locator('.cmt-reply', { hasText: 'Fridays can save' }).innerText(), /Bloomvow team[\s\S]*Fridays can save/);
  assert.equal(await p.locator('.post-cta a:has-text("wedding venues in Austin")').count(), 1);
  assert.deepEqual(p.errors, []);
});

test('comment form: friendly errors, honeypot, reply goes in held for moderation', async () => {
  const p = await page();
  await p.goto(`${SITE}${POST}`);
  await p.fill('#comment-form [name=name]', 'Lena');
  await p.fill('#comment-form [name=email]', 'not-an-email');
  await p.fill('#comment-form [name=body]', 'Are weekday prices much lower?');
  await p.click('#comment-form button[type=submit]');
  await p.locator('#comment-form .form-error:has-text("valid email")').waitFor();
  await p.click('.cmt button[data-reply]');
  assert.match(await p.locator('#replying').innerText(), /Replying to Priya/);
  await p.fill('#comment-form [name=email]', 'lena@example.com');
  await p.click('#comment-form button[type=submit]');
  await p.locator('.form-ok:has-text("awaiting moderation")').waitFor();
  const [c] = await q(`select c.status, p.author_name as parent from comments c join comments p on p.id = c.parent_id where c.author_email = 'lena@example.com'`);
  assert.deepEqual({ ...c }, { status: 'pending', parent: 'Priya' });
});

test('a comment or reply approved after the site was built shows right away', async () => {
  await q(`update comments set status = 'approved' where author_email = 'lena@example.com'`);
  const p = await page();
  await p.goto(`${SITE}${POST}`);
  const reply = p.locator('.cmt-reply:has-text("Are weekday prices much lower?")');
  await reply.waitFor();
  assert.match(await p.locator('.cmt:not(.cmt-reply)', { has: reply }).innerText(), /^Priya/, 'shown under the comment it replies to');
  assert.match(await p.locator('#comments-h').innerText(), /\d+ comments/);
  // Reply still works on the refreshed list; text is shown as text, never HTML.
  await p.click('.cmt button[data-reply]');
  assert.match(await p.locator('#replying').innerText(), /Replying to Priya/);
  await q(`update comments set status = 'pending' where author_email = 'lena@example.com'`);
  assert.deepEqual(p.errors, []);
});

test('planning guides on matching city pages, RSS and sitemap index', async () => {
  for (const f of ['us/texas/austin/index.html', 'us/texas/austin/wedding-venues/index.html']) assert.match(html(f), /Planning guides|planning guides/);
  assert.match(html('us/texas/austin/wedding-venues/index.html'), /how-much-does-a-wedding-venue-cost-in-austin/);
  assert.ok(!/how-much-does-a-wedding-venue-cost-in-austin/.test(html('us/texas/austin/photographers/index.html')), 'not on other categories');
  const rss = html('blog/rss.xml');
  assert.match(rss, /<item><title>How much does a wedding venue cost in Austin\?<\/title>/);
  assert.match(html('sitemap.xml'), /<sitemapindex[\s\S]*sitemap-1\.xml/);
  const sm = html('sitemap-1.xml');
  assert.match(sm, /\/blog\/how-much-does-a-wedding-venue-cost-in-austin\//);
  assert.match(sm, /\/blog\/category\/budget\//);
  assert.ok(!sm.includes('/vendor/open-data-florals-austin/'), 'basic imported listings stay out of the sitemap');
});

test('basic listing: its own static page (noindex, follow) with business schema and FAQs; still takes leads', async () => {
  const h = html('vendor/open-data-florals-austin/index.html');
  assert.match(h, /<meta name="robots" content="noindex, follow">/, 'contact details only: visible but not offered for indexing');
  assert.match(h, /<title>Open Data Florals – Wedding florist in Austin, TX \| Bloomvow<\/title>/);
  assert.match(h, /<h1[^>]*>Open Data Florals<\/h1>/);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const biz = ld.find((j) => j['@type'] === 'Florist');
  assert.equal(biz.telephone, '+15125550142');
  assert.match(h, /Call \(512\) 555-0142/, 'phone shown in US format');
  assert.deepEqual(biz.sameAs, ['https://opendataflorals.example']);
  assert.equal(biz.address.streetAddress, '200 Congress Ave');
  assert.ok(ld.some((j) => j['@type'] === 'FAQPage' && j.mainEntity[0].name === 'Where is Open Data Florals located?'));
  assert.deepEqual(ld.find((j) => j['@type'] === 'BreadcrumbList').itemListElement.map((x) => x.name), ['Home', 'Texas', 'Austin', 'Wedding florists', 'Open Data Florals']);
  assert.match(h, /<address class="nap"[^>]*>[\s\S]*200 Congress Ave[\s\S]*opendataflorals\.example/);
  assert.match(h, /Open Data Florals is a wedding florist based in Austin, Texas, at 200 Congress Ave\./, 'factual About text');
  assert.match(html('us/texas/austin/florists/index.html'), /href="\/vendor\/open-data-florals-austin\/"/, 'still listed on the city page');
  assert.ok(!html('sitemap-1.xml').includes('/vendor/open-data-florals-austin/'));

  const p = await page();
  await p.goto(`${SITE}/vendor/?v=open-data-florals-austin`);
  await p.waitForURL(/\/vendor\/open-data-florals-austin\/$/);   // old shared links redirect
  await p.fill('#lead-form [name=couple_name]', 'Ana & Leo');
  await p.fill('#lead-form [name=email]', 'ana.leo@example.com');
  await p.click('#lead-form button[type=submit]');
  await p.locator('.form-ok:has-text("Request sent")').waitFor();
  const [r] = await q(`select count(*)::int n from lead_recipients lr join leads l on l.id = lr.lead_id join vendors v on v.id = lr.vendor_id where l.email = 'ana.leo@example.com' and v.slug = 'open-data-florals-austin'`);
  assert.equal(r.n, 1);
  await p.goto(`${SITE}/vendor/?v=does-not-exist`);
  await p.locator('#bv-missing:has-text("Vendor not found")').waitFor();
  assert.deepEqual(p.errors, []);
});

test('a vendor added after the last build still opens (404 hands over to the shared page)', async () => {
  await q(`insert into vendors (slug, name, category_id, city_id, phone, status, source) values ('brand-new-cakes-austin', 'Brand New Cakes',
    (select id from categories where slug = 'wedding-cakes'), (select id from cities where name = 'Austin'), '+1 512-555-0199', 'unclaimed', 'overture')`);
  const p = await page();
  await p.goto(`${SITE}/vendor/brand-new-cakes-austin/`);
  await p.waitForURL(/\/vendor\/\?v=brand-new-cakes-austin$/);
  await p.locator('#bv-name:has-text("Brand New Cakes")').waitFor();
  await p.locator('#bv-nearby-h:has-text("More wedding cakes near Austin")').waitFor();
  await p.locator('#bv-team-h:has-text("Complete your wedding team in Austin")').waitFor();
});

test('paginated lists: each page is self-canonical, with prev/next links and its own description', () => {
  const base = 'us/texas/san-marcos/wedding-venues/';
  const p1 = html(`${base}index.html`), p2 = html(`${base}page/2/index.html`);
  const tag = (h, re) => h.match(re)?.[1];
  assert.equal(tag(p1, /<link rel="canonical" href="([^"]+)"/), `${SITE}/${base}`);
  assert.equal(tag(p2, /<link rel="canonical" href="([^"]+)"/), `${SITE}/${base}page/2/`, 'page 2 points to itself, not page 1');
  assert.ok(!/rel="prev"/.test(p1));
  assert.equal(tag(p1, /<link rel="next" href="([^"]+)"/), `${SITE}/${base}page/2/`);
  assert.equal(tag(p2, /<link rel="prev" href="([^"]+)"/), `${SITE}/${base}`);
  assert.match(tag(p2, /<meta name="description" content="([^"]+)"/), /^Page 2 of \d+: /);
  assert.notEqual(tag(p1, /<meta name="description" content="([^"]+)"/), tag(p2, /<meta name="description" content="([^"]+)"/));
});

test('vendor details on the public page: grouped lists, facts, FAQs and schema', () => {
  const h = html('vendor/harbor-garden-estate-austin/index.html');
  assert.match(h, /<section id="details"[^>]*>[\s\S]*Details &amp; amenities[\s\S]*Dance floor[\s\S]*Wheelchair accessible/);
  assert.match(h, /href="#details"/);
  assert.ok(!h.includes('not_a_field') && !h.includes('ignored'), 'unknown keys are not shown');
  assert.match(h, /In business<\/span><b[^>]*>12 years/);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const biz = ld.find((j) => j['@type'] === 'EventVenue');
  assert.deepEqual(biz.amenityFeature.map((a) => a.name), ['Bridal suite & dressing room', 'Dance floor', 'Wheelchair accessible']);
  assert.deepEqual(biz.knowsLanguage, ['English', 'Spanish']);
  assert.deepEqual(biz.hasOfferCatalog.itemListElement.map((o) => o.itemOffered.name), ['Food & catering', 'Bar & drinks']);
  const faq = ld.find((j) => j['@type'] === 'FAQPage').mainEntity.map((q) => q.name);
  assert.ok(faq.includes('Can we bring our own caterer to Harbor Garden Estate?'));
  assert.ok(faq.includes('Is Harbor Garden Estate wheelchair accessible?'));
});
