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
  browser = await chromium.launch();
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
  assert.equal(await p.locator('.cmt:not(.cmt-reply)').count(), 1);
  assert.match(await p.locator('.cmt-reply').innerText(), /Bloomvow team[\s\S]*Fridays can save/);
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
  assert.ok(!sm.includes('open-data-florals'), 'basic listings stay out of the sitemap');
});

test('basic listing: no built page, shared noindex page loads details and sends a lead', async () => {
  assert.ok(!fs.existsSync(path.join(DIST, 'vendor/open-data-florals-austin/index.html')));
  assert.match(html('vendor/index.html'), /noindex/);
  assert.match(html('us/texas/austin/florists/index.html'), /href="\/vendor\/\?v=open-data-florals-austin"/);
  const p = await page();
  await p.goto(`${SITE}/vendor/?v=open-data-florals-austin`);
  await p.locator('#bv-name:has-text("Open Data Florals")').waitFor();
  assert.match(await p.title(), /Open Data Florals: Wedding florist in Austin, TX/);
  assert.equal(await p.locator('#bv-phone').getAttribute('href'), 'tel:+15125550142');
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
