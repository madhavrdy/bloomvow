// Browser tests for the public site. Run through scripts/e2e.mjs (it starts
// the database, API and preview server and sets SITE / DB / DIST).
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
let browser, db;

const q = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'] });
  db = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.DB });
  await db.connect();
});
after(async () => { await browser?.close(); await db?.end(); });

async function page(opts = {}) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_UNKNOWN_URL_SCHEME|ERR_NAME_NOT_RESOLVED|ERR_PROXY_CONNECTION_FAILED/.test(m.text())) errors.push(m.text()); });
  p.errors = errors;
  return p;
}

test('homepage search goes to the city + category page', async () => {
  const p = await page();
  await p.goto(`${SITE}/`);
  assert.match(await p.title(), /Bloomvow/);
  await p.selectOption('#search-cat', 'wedding-venues');
  await p.fill('#search-where', 'Austin');
  await p.click('#search button[type=submit]');
  await p.waitForURL('**/us/texas/austin/wedding-venues/');
  assert.match(await p.locator('h1').innerText(), /Wedding venues in Austin, TX/);

  await p.goto(`${SITE}/`);
  await p.fill('#search-where', 'Atlantis');
  await p.click('#search button[type=submit]');
  await p.waitForSelector('#search-error:not(:empty)');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('listing filters, sorting and show more', async () => {
  const p = await page();
  await p.goto(`${SITE}/us/new-york/new-york-city/photographers/`);
  const total = Number(await p.locator('#count').innerText());
  const visible = () => p.locator('#list .item:not([hidden])').count();
  assert.equal(await visible(), Math.min(20, total));
  if (total > 20) {
    await p.click('#more');
    assert.equal(await visible(), Math.min(40, total));
  }
  await p.check('input[name=rating]');
  const ratings = await p.locator('#list .item:not([hidden])').evaluateAll((els) => els.map((e) => Number(e.dataset.rating)));
  assert.ok(ratings.every((r) => r >= 4.5));
  assert.ok(Number(await p.locator('#count').innerText()) <= total);
  await p.click('button[type=reset]');
  await p.waitForFunction((t) => document.getElementById('count').textContent === String(t), total);

  await p.selectOption('#sort', 'price');
  const prices = await p.locator('#list .item:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.price).filter(Boolean).map(Number));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

  await p.goto(`${SITE}/us/texas/austin/wedding-venues/`);
  const before = Number(await p.locator('#count').innerText());
  await p.check('input[name=guests][value="201"]');
  const caps = await p.locator('#list .item:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.cap));
  assert.ok(caps.every((c) => c === '' || Number(c) >= 201));
  assert.ok(Number(await p.locator('#count').innerText()) <= before);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('vendor profile: lead form sends to the vendor plus similar ones; views and clicks are tracked', async () => {
  const [v] = await q(`select id, slug, name from vendors where owner_id = '00000000-0000-0000-0000-00000000b001'`);
  const [{ n: viewsBefore }] = await q(`select count(*)::int n from events where vendor_id = $1 and kind = 'view'`, [v.id]);
  const p = await page();
  await p.goto(`${SITE}/vendor/${v.slug}/`);
  assert.equal(await p.locator('h1').innerText(), v.name);

  await p.evaluate(() => document.querySelectorAll('a[href^="tel:"]').forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
  await p.locator('.contact a[data-track=click_phone]').click();

  const email = `e2e-profile-${Date.now()}@example.com`;
  await p.fill('#lead-form [name=wedding_date]', '2027-06-12');
  await p.fill('#lead-form [name=guests]', '140');
  await p.fill('#lead-form [name=couple_name]', 'Test Couple');
  await p.fill('#lead-form [name=email]', email);
  await p.click('#lead-form button[type=submit]');
  const ok = await p.locator('#lead-form .form-ok').innerText();
  const shown = Number(ok.match(/to (\d+) vendors/)?.[1] ?? 1);

  const [lead] = await q(`select id, source, guests, wedding_date::text from leads where email = $1`, [email]);
  assert.equal(lead.source, 'profile');
  assert.equal(lead.guests, 140);
  assert.equal(lead.wedding_date, '2027-06-12');
  const rec = await q(`select vendor_id from lead_recipients where lead_id = $1`, [lead.id]);
  assert.equal(rec.length, shown);
  assert.ok(rec.some((r) => r.vendor_id === v.id));
  assert.ok(rec.length > 1, '"also send to similar" was ticked by default');

  await new Promise((r) => setTimeout(r, 300));
  const [{ n: viewsAfter }] = await q(`select count(*)::int n from events where vendor_id = $1 and kind = 'view'`, [v.id]);
  const [{ n: phone }] = await q(`select count(*)::int n from events where vendor_id = $1 and kind = 'click_phone' and created_at > now() - interval '1 minute'`, [v.id]);
  assert.equal(viewsAfter, viewsBefore + 1);
  assert.equal(phone, 1);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('lead form shows friendly errors from the API', async () => {
  const [v] = await q(`select slug from vendors where status <> 'hidden' order by slug limit 1`);
  const p = await page();
  await p.goto(`${SITE}/vendor/${v.slug}/`);
  await p.fill('#lead-form [name=couple_name]', 'X');
  await p.fill('#lead-form [name=email]', 'x@x.co');
  await p.fill('#lead-form [name=guests]', '5000');
  await p.locator('#lead-form [name=guests]').evaluate((el) => el.removeAttribute('max'));
  await p.click('#lead-form button[type=submit]');
  await p.waitForSelector('#lead-form .form-error:not(:empty)');
  assert.match(await p.locator('#lead-form .form-error').innerText(), /guest count/);
  await p.context().close();
});

test('Get matched: 4 steps with validation, routes to several categories', async () => {
  const p = await page();
  await p.goto(`${SITE}/get-matched/`);
  await p.click('#next');
  assert.match(await p.locator('#quote-error').innerText(), /at least one/);
  await p.locator('.chip:has(input[data-slug=wedding-venues])').click();
  await p.locator('.chip:has(input[data-slug=photographers])').click();
  await p.click('#next');
  await p.click('#next');
  assert.match(await p.locator('#quote-error').innerText(), /city/);
  await p.fill('#city-name', 'Austin, TX');
  await p.fill('[name=guests]', '120');
  await p.click('#next');
  await p.locator('.band:has(input[value="2"])').click();
  await p.click('#next');
  const email = `e2e-match-${Date.now()}@example.com`;
  await p.fill('[name=couple_name]', 'Match Couple');
  await p.fill('[name=email]', email);
  await p.click('#next');
  await p.waitForSelector('#done:not([hidden])');
  const title = await p.locator('#done-title').innerText();
  const n = Number(title.match(/(\d+)/)[1]);
  const [lead] = await q(`select id, source, budget_band, cardinality(category_ids) cats from leads where email = $1`, [email]);
  assert.equal(lead.source, 'matched');
  assert.equal(lead.budget_band, 2);
  assert.equal(lead.cats, 2);
  const [{ c }] = await q(`select count(*)::int c from lead_recipients where lead_id = $1`, [lead.id]);
  assert.equal(c, n);
  assert.ok(n >= 2 && n <= 6);
  assert.equal(await p.locator('#done-link').getAttribute('href'), '/us/texas/austin/');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('"Request pricing from several" pre-fills category and city and uses bulk routing', async () => {
  const p = await page();
  await p.goto(`${SITE}/us/texas/austin/photographers/`);
  await p.click('.save-time a');
  await p.waitForURL(/get-matched/);
  assert.ok(await p.locator('input[data-slug=photographers]').isChecked());
  await p.click('#next');
  await p.waitForFunction(() => document.getElementById('city-name').value === 'Austin, TX');
  await p.click('#next'); await p.click('#next');
  const email = `e2e-bulk-${Date.now()}@example.com`;
  await p.fill('[name=couple_name]', 'Bulk Couple');
  await p.fill('[name=email]', email);
  await p.click('#next');
  await p.waitForSelector('#done:not([hidden])');
  const [lead] = await q(`select source from leads where email = $1`, [email]);
  assert.equal(lead.source, 'bulk');
  await p.context().close();
});

test('shortlist saves vendors on this device', async () => {
  const p = await page();
  await p.goto(`${SITE}/us/texas/austin/wedding-venues/`);
  const heart = p.locator('[data-shortlist]').first();
  const name = await heart.getAttribute('data-name');
  await heart.click();
  assert.equal(await heart.getAttribute('aria-pressed'), 'true');
  await p.goto(`${SITE}/shortlist/`);
  assert.equal(await p.locator('#saved li a').first().innerText(), name);
  await p.context().close();
});

test('reviews are submitted as pending', async () => {
  const [v] = await q(`select id, slug from vendors where status <> 'hidden' order by slug offset 3 limit 1`);
  const p = await page();
  await p.goto(`${SITE}/vendor/${v.slug}/`);
  await p.click('.write-review summary');
  await p.fill('#review-form [name=name]', 'E2E Reviewer');
  await p.fill('#review-form [name=email]', 'r@example.com');
  await p.fill('#review-form [name=body]', 'Wonderful to work with, everything was on time and beautiful.');
  await p.click('#review-form button[type=submit]');
  await p.waitForSelector('.write-review .form-ok');
  const [r] = await q(`select status from reviews where vendor_id = $1 and author_name = 'E2E Reviewer'`, [v.id]);
  assert.equal(r.status, 'pending');
  await p.context().close();
});

test('mobile: no sideways scrolling, sticky request bar on profiles', async () => {
  const p = await page({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const [v] = await q(`select slug from vendors where status <> 'hidden' and phone is not null order by slug limit 1`);
  for (const url of ['/', '/us/texas/austin/wedding-venues/', `/vendor/${v.slug}/`, '/get-matched/']) {
    await p.goto(`${SITE}${url}`);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `${url} is ${w}px wide`);
  }
  await p.goto(`${SITE}/vendor/${v.slug}/`);
  assert.ok(await p.locator('.mbar').isVisible(), 'sticky call + request bar shows on phones');
  await p.goto(`${SITE}/`);
  await p.click('.mobile-menu summary');
  assert.ok(await p.locator('.mobile-panel').isVisible(), 'mobile menu opens');
  await p.context().close();
});

test('SEO: titles, canonicals, structured data, noindex for thin pages, no private data in HTML', async () => {
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, f.name); if (f.isDirectory()) walk(fp); else if (f.name === 'index.html') files.push(fp); } };
  walk(DIST);
  const sitemap = fs.readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n');
  const titles = new Map();
  let thin = 0;
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    const rel = '/' + path.relative(DIST, path.dirname(f)).split(path.sep).join('/') + '/';
    const url = rel === '//' ? '/' : rel;
    assert.match(html, /<link rel="canonical" href="[^"]+"/, `${url} has a canonical`);
    assert.doesNotMatch(html, /hello@[a-z0-9-]+\.example|@vendor\.local/, `${url} must not expose vendor emails`);
    for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) JSON.parse(m[1]);
    const title = html.match(/<title>(.*?)<\/title>/)[1];
    const noindex = html.includes('name="robots" content="noindex');
    if (!noindex) {
      assert.ok(!titles.has(title), `duplicate title "${title}" on ${url} and ${titles.get(title)}`);
      titles.set(title, url);
    }
    const inSitemap = sitemap.includes(`${SITE}${url}<`) || sitemap.includes(`<loc>${SITE}${url}</loc>`);
    if (noindex) { thin++; assert.ok(!inSitemap, `${url} is noindex but in the sitemap`); }
    if (/^\/us\/[^/]+\/[^/]+\/[^/]+\/$/.test(url) && !noindex) assert.ok(inSitemap, `${url} is indexable but missing from the sitemap`);
  }
  assert.ok(thin > 0, 'sample data includes thin pages');
  const [{ min }] = await q(`select (value #>> '{}')::int min from settings where key = 'min_vendors_to_index'`);
  const austinVenues = fs.readFileSync(path.join(DIST, 'us/texas/austin/wedding-venues/index.html'), 'utf8');
  assert.ok(!austinVenues.includes('noindex'));
  assert.match(austinVenues, /"@type":"FAQPage"/);
  assert.match(austinVenues, /"@type":"BreadcrumbList"/);
  assert.ok(min >= 1);
});

test('unknown pages return the 404 page', async () => {
  const p = await page();
  const res = await p.goto(`${SITE}/no-such-page/`);
  assert.equal(res.status(), 404);
  assert.match(await p.locator('h1').innerText(), /couldn't find/);
  // An unknown vendor address is checked against the database, then says so.
  await p.goto(`${SITE}/vendor/does-not-exist/`);
  await p.locator('#bv-missing h1:has-text("Vendor not found")').waitFor();
  await p.context().close();
});

test('header search: suggestions for pages and vendor names, keyboard and Enter, results page; mobile toggle', async () => {
  const p = await (await browser.newContext()).newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${SITE}/blog/`);
  const input = p.locator('#hsearch input[name=q]');
  await input.fill('venues austin');
  await p.locator('#hsearch-list li:has-text("Wedding venues in Austin, TX")').first().waitFor();
  await p.keyboard.press('ArrowDown');
  assert.equal(await input.getAttribute('aria-activedescendant'), 'hs-0');
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/us\/texas\/austin\/wedding-venues\/$/);

  await p.locator('#hsearch input[name=q]').fill('open data flor');
  await p.locator('#hsearch-list li:has-text("Open Data Florals")').waitFor();
  await p.click('#hsearch-list li:has-text("Open Data Florals") a');
  await p.waitForURL(/\/vendor\/open-data-florals-austin\/$/);

  await p.goto(`${SITE}/search/?q=florists`);
  await p.locator('#sp-status:has-text("results for")').waitFor();
  assert.ok(await p.locator('#sp-pages li').count() > 0);
  assert.match(await p.locator('meta[name=robots]').getAttribute('content'), /noindex/);
  assert.deepEqual(errors, []);

  // Phone: the box is behind a search icon and opens full width.
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await m.goto(`${SITE}/`);
  assert.equal(await m.locator('#hsearch').isVisible(), false);
  await m.click('#hsearch-toggle');
  assert.equal(await m.locator('#hsearch').isVisible(), true);
  const box = await m.locator('#hsearch').boundingBox();
  assert.ok(box.width > 330, `full width on phones: ${box.width}`);
  assert.ok(await m.evaluate(() => document.activeElement?.getAttribute('name') === 'q'), 'keyboard opens straight away');
  await m.locator('#hsearch input').fill('photographers');
  await m.locator('#hsearch-list li').first().waitFor();
  const list = await m.locator('#hsearch-list').boundingBox();
  assert.ok(list.x >= 0 && list.x + list.width <= 390, 'suggestions fit on screen');
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= 390), 'no sideways scrolling');
});

test('tracking: tags from Admin > Tracking on public pages only; lead and contact events fire', async () => {
  const read = (f) => fs.readFileSync(path.join(DIST, f), 'utf8');
  const home = read('index.html');
  assert.match(home, /<meta name="google-site-verification" content="gsc-test-token-123">/);
  assert.match(home, /googletagmanager\.com\/gtag\/js\?id=G-TEST12345/);
  assert.match(home, /"G-TEST12345","AW-111222333"/);
  assert.match(home, /fbq\('init', pixel\)/);
  assert.match(home, /facebook\.com\/tr\?id=1234567890&(amp;)?ev=PageView/);
  assert.ok(!/bing|msvalidate|gtm\.js/.test(home), 'tools that are not set add nothing');
  for (const f of ['back-end/index.html', 'vendor-dashboard/index.html']) assert.ok(!/gtag|fbq|google-site-verification/.test(read(f)), `${f}: no tags`);
  assert.match(read('get-matched/index.html'), /fbq\('init'/, 'quote flow is tracked');

  const [v] = await q(`select slug from vendors where owner_id = '00000000-0000-0000-0000-00000000b001'`);
  const p = await page();
  await p.goto(`${SITE}/vendor/${v.slug}/`);
  assert.deepEqual(await p.evaluate(() => window.fbq.queue.map((a) => [...a])), [['init', '1234567890'], ['track', 'PageView']]);
  await p.evaluate(() => document.querySelectorAll('a[href^="tel:"]').forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
  await p.locator('.contact a[data-track=click_phone]').click();
  await p.fill('#lead-form [name=wedding_date]', '2027-06-12');
  await p.fill('#lead-form [name=guests]', '120');
  await p.fill('#lead-form [name=couple_name]', 'Pixel Couple');
  await p.fill('#lead-form [name=email]', `e2e-pixel-${Date.now()}@example.com`);
  await p.click('#lead-form button[type=submit]');
  await p.locator('#lead-form .form-ok').waitFor();
  const fb = await p.evaluate(() => window.fbq.queue.map((a) => [a[0], a[1]]));
  assert.deepEqual(fb.slice(2), [['track', 'Contact'], ['track', 'Lead']]);
  const g = await p.evaluate(() => window.dataLayer.filter((a) => a[0] === 'event').map((a) => [a[1], a[2]?.send_to ?? a[2]?.method ?? a[2]?.form]));
  assert.deepEqual(g, [['contact', 'phone'], ['generate_lead', 'vendor_profile'], ['conversion', 'AW-111222333/LeadLabel1']]);
});
