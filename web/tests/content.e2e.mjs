// Browser tests for page content, database-backed filters, style pages and GEO/AEO markup.
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
const AUSTIN = '/us/texas/austin/wedding-venues/';
const SM = '/us/texas/san-marcos/wedding-venues/';
let browser, db;
const q = async (sql, params) => (await db.query(sql, params)).rows;
const html = (f) => fs.readFileSync(path.join(DIST, f), 'utf8');
const ld = (h, type) => [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1])).filter((j) => j['@type'] === type);

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

test('page content: SEO title, short intro on top, guide below the listings, custom FAQ first and in the schema', async () => {
  const h = html('us/texas/austin/wedding-venues/index.html');
  assert.match(h, /<title>Austin Wedding Venues: Prices &amp; Availability \| Bloomvow<\/title>/);
  const intro = h.indexOf('Hill Country ranches'), list = h.indexOf('id="list"'), guide = h.indexOf('id="guide"'), faq = h.indexOf('FAQs</h2>');
  assert.ok(intro > 0 && intro < list && list < guide && guide < faq, 'intro, listings, guide, FAQs in that order');
  assert.match(h, /href="#guide"[^>]*>Read the full guide ↓/);
  assert.match(h, /<nav class="toc" aria-label="In this guide">[\s\S]*How much do Austin venues cost\?[\s\S]*When to book[\s\S]*Questions to ask/);
  assert.ok(h.indexOf('Are Austin venues cheaper on Fridays?') < h.indexOf('What are the best wedding venues in Austin?'), 'custom FAQ first');
  const faqLd = ld(h, 'FAQPage')[0];
  assert.equal(faqLd.mainEntity[0].name, 'Are Austin venues cheaper on Fridays?');
  assert.ok(faqLd.mainEntity.length > 1, 'automatic FAQs still included');
  // Pages without custom content keep the automatic intro and have no guide.
  const p2 = html('us/texas/austin/photographers/index.html');
  assert.match(p2, /Compare \d+ wedding photographers in Austin, Texas/);
  assert.ok(!p2.includes('id="guide"'));
});

test('AEO: at-a-glance summary, visible last-updated date, CollectionPage with dateModified', () => {
  const h = html('us/texas/austin/wedding-venues/index.html');
  assert.match(h, /<aside class="glance"[\s\S]*At a glance[\s\S]*wedding venues serve Austin\./);
  assert.match(h, /Last updated <time datetime="\d{4}-\d{2}-\d{2}/);
  const cp = ld(h, 'CollectionPage')[0];
  assert.equal(cp.name, 'Wedding venues in Austin, TX');
  assert.match(cp.dateModified, /^\d{4}-\d{2}-\d{2}/);
});

test('style sub-pages: barn & ranch venues page, indexable, linked from the listing and in the sitemap', async () => {
  const h = html('us/texas/san-marcos/wedding-venues/barn/index.html');
  assert.match(h, /<h1[^>]*>Barn &amp; ranch wedding venues in San Marcos, TX<\/h1>/);
  assert.ok(!/noindex/.test(h));
  assert.match(h, /<link rel="canonical" href="[^"]*\/us\/texas\/san-marcos\/wedding-venues\/barn\/"/);
  assert.match(html('us/texas/san-marcos/wedding-venues/index.html'), /href="\/us\/texas\/san-marcos\/wedding-venues\/barn\/"[^>]*>Barn &amp; ranch \(\d+\)/);
  assert.match(html('sitemap-1.xml'), /\/us\/texas\/san-marcos\/wedding-venues\/barn\//);
  const p = await page();
  await p.goto(`${SITE}${SM}barn/`);
  const names = await p.locator('.item:not([hidden]) .vrow-name').allTextContents();
  assert.ok(names.length > 0 && names.every((n) => /barn|ranch|farm/i.test(n)), names.join(','));
  assert.deepEqual(p.errors, []);
});

test('filters on a big listing query the database, live in the URL, and "show more" pages through', async () => {
  // Expected total: vendors based in San Marcos or serving it (service area) that fit 201+ guests.
  const [{ n }] = await q(`select (search_vendors((select id from cities where name = 'San Marcos'), (select id from categories where slug = 'wedding-venues'),
    '{"guests":201}'::jsonb)->>'total')::int n`);
  const [{ direct }] = await q(`select count(*)::int direct from vendors v join cities c on c.id = v.city_id join categories k on k.id = v.category_id
    where c.name = 'San Marcos' and k.slug = 'wedding-venues' and v.status <> 'hidden' and v.capacity_max >= 201`);
  assert.ok(n >= direct && n > 20, `${n} vs ${direct}`);
  const p = await page();
  await p.goto(`${SITE}${SM}`);
  assert.match(await p.locator('.pager').innerText(), /1\s*2/, 'more than one page of vendors');
  await p.check('#filters input[name=guests][value="201"]');
  await p.waitForFunction((want) => document.getElementById('count')?.textContent === String(want), n);
  assert.match(p.url(), /\?guests=201$/);
  assert.equal(new URL(await p.locator('link[rel=canonical]').getAttribute('href')).search, '', 'canonical stays the plain page');
  assert.equal(await p.locator('.db-item').count(), Math.min(20, n));
  assert.ok(await p.locator('.pager').isHidden());
  if (n > 20) {
    await p.click('#more');
    await p.waitForFunction((want) => document.querySelectorAll('.db-item').length === want, Math.min(40, n));
  }
  // Every capacity shown meets the filter.
  const caps = (await p.locator('.db-item .vrow-facts').allTextContents()).map((t) => Number(t.match(/Up to (\d+)/)?.[1]));
  assert.ok(caps.every((c) => c >= 201), caps.join(','));
  // A shared filtered link opens with the filters applied, sorted by price.
  const p2 = await page();
  await p2.goto(`${SITE}${SM}?guests=201&sort=price`);
  await p2.waitForSelector('.db-item');
  assert.equal(await p2.locator('#filters input[name=guests][value="201"]').isChecked(), true);
  assert.equal(await p2.locator('#sort').inputValue(), 'price');
  const prices = (await p2.locator('.db-item .vrow-facts').allTextContents()).map((t) => Number(t.match(/From \$([\d,]+)/)?.[1].replace(/,/g, '')));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  // "Clear all" clears the filters but keeps the chosen sort (still across every vendor);
  // back to "Recommended" returns to the static page.
  await p2.click('#filters button[type=reset]');
  await p2.waitForFunction(() => location.search === '?sort=price');
  await p2.selectOption('#sort', 'rec');
  await p2.waitForFunction(() => document.querySelectorAll('.db-item').length === 0);
  assert.equal(new URL(p2.url()).search, '');
  assert.equal(await p2.locator('.item:not(.db-item):not([hidden])').count(), 20);
  assert.deepEqual([...p.errors, ...p2.errors], []);
});

test('GEO: robots.txt welcomes AI crawlers, llms.txt, Organization + WebSite schema, hreflang, share images, IndexNow key', () => {
  const robots = html('robots.txt');
  for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) assert.match(robots, new RegExp(`User-agent: ${bot}\\nAllow: /\\nDisallow: /vendor-dashboard/`));
  assert.ok(!robots.includes("back-end"), "the back-end address is not advertised");
  const llms = html('llms.txt');
  assert.match(llms, /^# Bloomvow\n\n> /);
  assert.match(llms, /## Popular city pages\n- \[/);
  const home = html('index.html');
  assert.equal(ld(home, 'Organization')[0].name, 'Bloomvow');
  assert.equal(ld(home, 'WebSite')[0].publisher['@id'], ld(home, 'Organization')[0]['@id']);
  assert.match(home, /<link rel="alternate" hreflang="x-default"/);
  assert.match(home, /<link rel="alternate" hreflang="en-us" href="[^"]*\/us\/"/);
  assert.match(html('us/texas/austin/index.html'), /hreflang="en-us"/);
  assert.match(home, /<meta property="og:image" content="[^"]*\/og-default\.png"/);
  assert.ok(fs.existsSync(path.join(DIST, 'og-default.png')));
  const key = fs.readdirSync(DIST).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  assert.equal(html(key), key.replace('.txt', ''));
});

test('blog author pages with Person schema, linked from posts', async () => {
  const post = html('blog/how-much-does-a-wedding-venue-cost-in-austin/index.html');
  assert.match(post, /<a rel="author" href="\/blog\/author\/wren-writer\/"/);
  assert.match(ld(post, 'BlogPosting')[0].author.url, /\/blog\/author\/wren-writer\/$/);
  const a = html('blog/author/wren-writer/index.html');
  assert.equal(ld(a, 'Person')[0].name, 'Wren Writer');
  assert.match(a, /How much does a wedding venue cost in Austin\?/);
});

test('page views are counted for content pages (for "sort by traffic")', async () => {
  const before = (await q(`select count(*)::int n from events where kind = 'page_view' and page_path = $1`, [AUSTIN]))[0].n;
  const p = await page();
  await p.goto(`${SITE}${AUSTIN}`);
  await p.waitForTimeout(800);
  const after_ = (await q(`select count(*)::int n from events where kind = 'page_view' and page_path = $1`, [AUSTIN]))[0].n;
  assert.equal(after_, before + 1);
});

test('vendor pages: "More … near …" ranked by location then popularity, and "Complete your wedding team"', async () => {
  // Full (pre-built) profile.
  const [v] = await q(`select v.slug, c.name city from vendors v join cities c on c.id = v.city_id join categories k on k.id = v.category_id
    where c.name = 'Austin' and k.slug = 'wedding-venues' and v.description is not null and v.status <> 'hidden' order by v.slug limit 1`);
  const h = html(`vendor/${v.slug}/index.html`);
  assert.match(h, /<h2 class="serif" id="nearby-h"[^>]*>More wedding venues near Austin<\/h2>/);
  assert.match(h, /<h2 class="serif" id="team-h"[^>]*>Complete your wedding team in Austin<\/h2>/);
  const nearbyBlock = h.slice(h.indexOf('id="nearby-h"'), h.indexOf('id="team-h"'));
  assert.ok(!nearbyBlock.includes(`/vendor/${v.slug}/"`), 'a vendor is not listed next to itself');
  const cities = [...nearbyBlock.matchAll(/<span class="muted"[^>]*>([^<,]+), TX<\/span>/g)].map((m) => m[1]);
  assert.ok(cities.length > 0);
  const firstOther = cities.findIndex((c) => c !== 'Austin');
  assert.ok(firstOther === -1 || cities.slice(firstOther).every((c) => c !== 'Austin'), `same city first: ${cities.join(',')}`);
  assert.match(h.slice(h.indexOf('id="team-h"')), /class="vcard-cat"[^>]*>Wedding photographer</);

  // Basic (open-data) listings get the same sections on their own page.
  const b = html('vendor/open-data-florals-austin/index.html');
  assert.match(b, /More wedding florists near Austin/);
  assert.match(b, /Complete your wedding team in Austin/);
  const p = await page();
  assert.deepEqual(p.errors, []);
});

test('category images: home page and /categories/ show the same image cards with counts', () => {
  const home = html('index.html');
  assert.match(home, /<a href="\/categories\/wedding-venues\/" class="cat"[^>]*>\s*<span class="cat-img"[^>]*>\s*<img src="\/img\/categories\/wedding-venues\.svg"/);
  const cats = html('categories/index.html');
  const cards = [...cats.matchAll(/<a href="\/categories\/([a-z-]+)\/" class="cat"/g)].map((m) => m[1]);
  assert.ok(cards.length >= 10, String(cards.length));
  for (const slug of cards) assert.ok(fs.existsSync(path.join(DIST, 'img/categories', `${slug}.svg`)), `illustration for ${slug}`);
  assert.match(cats, /class="muted cat-count"[^>]*>[\d,]+ vendors · \d+ cit(y|ies)</);
  assert.equal(ld(cats, 'ItemList')[0].itemListElement.length, cards.length);
});

test('venue location FAQs: 8 questions, short direct answers built from local listings, unique per city, linked', () => {
  const faqsOf = (f) => ld(html(f), 'FAQPage')[0].mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }));
  const austin = faqsOf('us/texas/austin/wedding-venues/index.html').filter((f) => !/Fridays/.test(f.q));
  assert.deepEqual(austin.map((f) => f.q), [
    'What are the best wedding venues in Austin?',
    'How much does it cost to book a wedding venue in Austin?',
    'Where can I find small wedding venues in Austin for an intimate celebration?',
    'What are the best outdoor wedding venues in Austin?',
    'How do I find a wedding reception venue in Austin that fits my guest count and budget?',
    'Are there all-inclusive wedding venues in Austin that offer catering and other services?',
    'How can I compare and choose the right wedding venue in Austin?',
    'How far in advance should I book a wedding venue in Austin?',
  ]);
  for (const f of austin) {
    const words = f.a.split(/\s+/).length;
    assert.ok(words >= 25 && words <= 90, `${f.q}: ${words} words`);
  }
  assert.match(austin[0].a, /We list \d+ wedding venues and reception locations in and around Austin\./);
  assert.match(austin[7].a, /spring and fall/, 'Texas: hot-summer season advice');
  const h = html('us/texas/austin/wedding-venues/index.html');
  assert.match(h, /<p class="faq-links"[^>]*>(?:(?!<\/p>)[\s\S])*?href="\/vendor\//, 'answers link to listed venues');
  assert.equal(ld(h, 'FAQPage')[0].mainEntity.length, austin.length + 1, 'one FAQPage, custom FAQ included');
  // Another city gets its own answers, not a copy.
  const other = fs.readdirSync(path.join(DIST, 'us'), { withFileTypes: true }).filter((r) => r.isDirectory()).map((r) => r.name).flatMap((r) => fs.readdirSync(path.join(DIST, 'us', r), { withFileTypes: true })
    .filter((x) => x.isDirectory()).map((x) => `us/${r}/${x.name}/wedding-venues/index.html`))
    .find((f) => !f.includes('/austin/') && fs.existsSync(path.join(DIST, f)));
  const o = faqsOf(other);
  assert.notEqual(o[0].a, austin[0].a);
  assert.ok(!o.some((f) => /Austin/.test(f.q)), 'questions name their own city');
  // Page 2 has no FAQs (they live on page 1 only).
  const p2 = path.join(DIST, 'us/texas/austin/wedding-venues/page/2/index.html');
  if (fs.existsSync(p2)) assert.ok(!fs.readFileSync(p2, 'utf8').includes('FAQPage'));
});
