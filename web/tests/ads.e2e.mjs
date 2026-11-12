// Ads: sponsor banners on city and vendor pages (managed in Admin > Ads), AdSense units on the
// blog and as fallback, nothing on featured vendors, view/click counts, ads.txt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = process.env.SITE;
let browser, db, admin;
const q = async (sql, params) => (await db.query(sql, params)).rows;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function page(viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  return p;
}
before(async () => {
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'] });
  db = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.DB });
  await db.connect();
  admin = await page({ width: 1440, height: 1000 });
  await admin.goto(`${SITE}/back-end/`);
  await admin.fill('input[type=email]', 'admin@bloomvow.local');
  await admin.fill('input[type=password]', 'password123');
  await admin.click('form.auth button.btn-acc');
  await admin.waitForSelector('.dash.admin .side');
});
after(async () => { await browser?.close(); await db?.end(); });
const toast = async (p, re) => { await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('.toast')?.textContent ?? ''), re.source); };

test('Admin > Ads: create a sponsor banner for Austin venues', async () => {
  await admin.goto(`${SITE}/back-end/#ads`);
  await admin.waitForSelector('.dmain h1:has-text("Ads")');
  await admin.click('button:has-text("+ New banner")');
  await admin.fill('label:has-text("Banner name") input', 'Hill Country Rentals spring');
  await admin.fill('label:has-text("Advertiser") input', 'Hill Country Rentals');
  await admin.setInputFiles('input[aria-label="Upload banner image"]', { name: 'banner.png', mimeType: 'image/png', buffer: PNG });
  await admin.locator('form[class=panel] img').first().waitFor();
  await admin.fill('label:has-text("Link") input', 'https://hillcountry.example/austin');
  await admin.locator('label.check:has-text("Vendor pages") input').check();
  await admin.selectOption('[role=dialog] select[aria-label=State]', { label: 'Texas' });
  await admin.selectOption('[role=dialog] select[aria-label=City]', { label: 'Austin, TX' });
  await admin.selectOption('[role=dialog] select[aria-label=Category]', { label: 'Wedding venues' });
  await admin.click('button:has-text("Save banner")');
  await toast(admin, /saved/);
  const [b] = await q(`select * from ad_campaigns where name = 'Hill Country Rentals spring'`);
  assert.deepEqual(b.placements, ['city_top', 'vendor_page']);
  assert.match(b.image_url, /\/storage\/v1\/object\/public\/ad-images\//);
  assert.equal(b.alt, 'Hill Country Rentals');
  assert.equal((await fetch(b.image_url)).status, 200);
  await admin.locator('tr:has-text("Hill Country Rentals spring") .badge-green:has-text("Live")').waitFor();
  assert.deepEqual(admin.errors, []);
});

test('city page shows the banner, counts the view and the click', async () => {
  const [b] = await q(`select id from ad_campaigns where name = 'Hill Country Rentals spring'`);
  const p = await page();
  await p.goto(`${SITE}/us/texas/austin/wedding-venues/`);
  const slot = p.locator('.ad-slot[data-ad=city_top]');
  await slot.locator('.ad-sponsor img').waitFor();
  assert.match(await slot.locator('.ad-label').textContent(), /Sponsored/);
  assert.equal(await slot.locator('a').getAttribute('rel'), 'sponsored noopener');
  assert.equal(await p.locator('.ad-slot[data-ad=city_list]').isHidden(), true, 'nothing booked in the list spot');
  for (let i = 0; i < 30; i++) { if ((await q(`select coalesce(sum(views),0)::int v from ad_stats where ad_id = $1`, [b.id]))[0].v > 0) break; await p.waitForTimeout(100); }
  assert.equal((await q(`select coalesce(sum(views),0)::int v from ad_stats where ad_id = $1`, [b.id]))[0].v, 1, 'one view');
  const [popup] = await Promise.all([p.context().waitForEvent('page'), slot.locator('a').click()]);
  await popup.close();
  for (let i = 0; i < 30; i++) { if ((await q(`select coalesce(sum(clicks),0)::int c from ad_stats where ad_id = $1`, [b.id]))[0].c > 0) break; await p.waitForTimeout(100); }
  assert.equal((await q(`select coalesce(sum(clicks),0)::int c from ad_stats where ad_id = $1`, [b.id]))[0].c, 1, 'one click');
  // Another city's page doesn't get the Austin banner.
  await p.goto(`${SITE}/us/texas/dallas/wedding-venues/`).catch(() => {});
  await p.waitForTimeout(800);
  assert.equal(await p.locator('.ad-slot[data-ad=city_top] .ad-sponsor').count(), 0);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('vendor pages: free ones show the banner; featured ones have no ad slot at all', async () => {
  const [free] = await q(`select v.slug from vendors v join cities c on c.id = v.city_id join categories k on k.id = v.category_id
    where c.name = 'Austin' and k.slug = 'wedding-venues' and v.plan = 'free' and v.status <> 'hidden' order by v.slug limit 1`);
  const [paid] = await q(`select slug from vendors where plan = 'featured' and status <> 'hidden' limit 1`);
  const p = await page();
  await p.goto(`${SITE}/vendor/${free.slug}/`);
  await p.locator('.ad-slot[data-ad=vendor_page] .ad-sponsor img').waitFor();
  if (paid) {
    await p.goto(`${SITE}/vendor/${paid.slug}/`);
    await p.waitForLoadState('networkidle');
    // Built as featured: no slot at all. Upgraded since the last build: the slot stays empty.
    assert.equal(await p.locator('.ad-slot:not([hidden])').count(), 0, 'featured vendor: no ad shown');
  }
  await p.context().close();
});

test('AdSense: settings saved from the admin fill the blog and switched-off spots stay empty', async () => {
  await admin.goto(`${SITE}/back-end/#ads`);
  await admin.waitForSelector('form[aria-label="Google AdSense"]');
  await admin.fill('form[aria-label="Google AdSense"] label:has-text("Publisher ID") input',
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>');
  await admin.fill('input[aria-label="Ad-unit ID for Blog post: after intro"]', 'data-ad-slot="1111111111"');
  await admin.fill('input[aria-label="Ad-unit ID for Blog post: end"]', '2222222222');
  await admin.fill('input[aria-label="Ad-unit ID for Blog list"]', '3333333333');
  await admin.fill('input[aria-label="Ad-unit ID for City pages: in the list"]', '4444444444');
  await admin.locator('input[aria-label="Show ads: Blog post: end"]').uncheck();
  await admin.fill('input[aria-label="Ad-unit ID for Vendor pages"]', 'abc');
  await admin.click('button:has-text("Save AdSense settings")');
  await toast(admin, /fix the highlighted/);
  await admin.fill('input[aria-label="Ad-unit ID for Vendor pages"]', '');
  await admin.click('button:has-text("Save AdSense settings")');
  await toast(admin, /Saved/);
  const [s] = await q(`select value from settings where key = 'ads'`);
  assert.deepEqual(s.value, { client: 'ca-pub-1234567890123456', slots: { city_list: '4444444444', blog_list: '3333333333', post_intro: '1111111111', post_end: '2222222222' }, off: ['post_end'] });
  assert.match(await admin.locator('details pre').textContent(), /google\.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0/);

  const p = await page();
  const [post] = await q(`select slug from posts where status = 'published' and body ~ '\\n## ' order by published_at desc limit 1`);
  await p.goto(`${SITE}/blog/${post.slug}/`);
  const intro = p.locator('.ad-slot[data-ad=post_intro]');
  await intro.locator('ins.adsbygoogle').waitFor({ state: 'attached' });
  assert.equal(await intro.locator('ins').getAttribute('data-ad-client'), 'ca-pub-1234567890123456');
  assert.equal(await intro.locator('ins').getAttribute('data-ad-slot'), '1111111111');
  assert.match(await intro.locator('.ad-label').textContent(), /Advertisement/);
  assert.equal(await p.locator('.ad-slot[data-ad=post_end]').isHidden(), true, 'switched off');
  assert.equal(await p.locator('script[src*="adsbygoogle.js?client=ca-pub-1234567890123456"]').count(), 1, 'AdSense script loaded once');
  // City list spot: no banner booked there, so AdSense fills it.
  await p.goto(`${SITE}/us/texas/austin/wedding-venues/`);
  await p.locator('.ad-slot[data-ad=city_list] ins.adsbygoogle[data-ad-slot="4444444444"]').waitFor({ state: 'attached' });
  await p.locator('.ad-slot[data-ad=city_top] .ad-sponsor').waitFor();
  await p.context().close();
  await q(`update settings set value = '{}' where key = 'ads'`);
  await q(`delete from ad_campaigns`);
});

test('ads.txt is published', async () => {
  const res = await fetch(`${SITE}/ads.txt`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /No advertising partners yet|google\.com, pub-/);
});
