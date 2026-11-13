// Browser tests for the admin dashboard: access control, overview, leads,
// vendors, claims, CSV import, reviews, categories/cities, blog posts,
// blog categories, comment moderation and team roles.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = process.env.SITE;
let browser, db, admin;
const q = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'] });
  db = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.DB });
  await db.connect();
  admin = await signedIn('admin@bloomvow.local');
});
after(async () => { await browser?.close(); await db?.end(); });

async function signedIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(`${SITE}/back-end/`);
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', 'password123');
  await p.click('form.auth button.btn-acc');
  await p.waitForSelector('.dash.admin .side');
  return p;
}
const go = async (p, route) => { await p.goto(`${SITE}/back-end/#${route}`); await p.waitForSelector('.dmain h1'); };
const toast = async (p, re) => { await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('.toast')?.textContent ?? ''), re.source); };

test('the back end lives at /back-end/; the old /admin/ address does not exist', async () => {
  const res = await fetch(`${SITE}/admin/`);
  assert.equal(res.status, 404);
  assert.equal((await fetch(`${SITE}/back-end/`)).status, 200);
});

test('access: vendors are denied, editors see only content screens, sign-up is not offered', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${SITE}/back-end/`);
  assert.equal(await p.locator('text=New account').count(), 0, 'no public sign-up on the admin page');
  await p.fill('input[type=email]', 'dana@vendor.local');
  await p.fill('input[type=password]', 'password123');
  await p.click('form.auth button.btn-acc');
  await p.waitForSelector('text=Access denied');
  await ctx.close();

  const ed = await signedIn('writer@bloomvow.local');
  const nav = await ed.locator('.side a[href^="#"]').allInnerTexts();
  assert.deepEqual(nav.map((t) => t.replace(/\d+$/, '').trim()), ['Page content', 'Blog posts', 'Blog categories']);
  await ed.goto(`${SITE}/back-end/#leads`);
  await ed.waitForSelector('.dmain h1');
  assert.equal(await ed.locator('.dmain h1').innerText(), 'Page content', 'editors are sent to content, not leads');
  await ed.context().close();
});

test('overview: numbers match the database, including clicks; attention list links work', async () => {
  await go(admin, 'overview');
  await admin.waitForFunction(() => document.querySelectorAll('.kpi b')[0]?.textContent !== '–');
  const [s] = await q(`select count(*)::int leads from leads where created_at >= now() - interval '14 days' and status <> 'spam'`);
  // Events right at the 14-day edge can drop out between the page loading and this query.
  const [c] = await q(`select count(*) filter (where created_at >= now() - interval '14 days')::int clicks,
    count(*) filter (where created_at >= now() - interval '14 days' - interval '2 minutes')::int edge
    from events where kind in ('click_phone','click_website','click_directions')`);
  const k = await admin.locator('.kpi b').allInnerTexts();
  assert.equal(Number(k[0].replace(/,/g, '')), s.leads);
  const shown = Number(k[2].replace(/,/g, ''));
  assert.ok(shown >= c.clicks && shown <= c.edge, `clicks ${shown} should be ${c.clicks}`);
  assert.match(await admin.locator('.panel:has-text("Needs attention")').innerText(), /Blog comments to moderate\s*2/);
  assert.deepEqual(admin.errors, []);
});

test('leads: search, filter, detail with routing log, re-route and spam', async () => {
  await go(admin, 'leads');
  await admin.waitForSelector('tbody tr');
  const [l] = await q(`select l.id, l.couple_name, l.email from leads l where l.status = 'routed' and exists (select 1 from lead_recipients where lead_id = l.id) order by created_at desc limit 1`);
  await admin.fill('input[type=search]', l.email);
  await admin.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  await admin.click('tbody tr');
  await admin.waitForSelector('[aria-label="Lead detail"]');
  const before = (await q(`select count(*)::int n from lead_recipients where lead_id = $1`, [l.id]))[0].n;
  assert.equal(await admin.locator('[aria-label="Lead detail"] .chip-s').count() - 1, before, 'one routing-log row per recipient');
  await admin.click('button:has-text("Send to 3 more vendors")');
  await toast(admin, /Sent to \d+ more|No other matching/);
  const after = (await q(`select count(*)::int n from lead_recipients where lead_id = $1`, [l.id]))[0].n;
  assert.ok(after >= before);
  await admin.click('button:has-text("Mark as spam")');
  await toast(admin, /Marked as spam/);
  assert.equal((await q(`select status from leads where id = $1`, [l.id]))[0].status, 'spam');
  await admin.click('button:has-text("Not spam")');
  await toast(admin, /not spam/);
});

test('vendors: search, edit details, set Featured with renewal date', async () => {
  await go(admin, 'vendors');
  const [v] = await q(`select id, name from vendors where source = 'sample' and status = 'unclaimed' order by slug limit 1`);
  await admin.fill('input[type=search]', v.name);
  await admin.click('form button:has-text("Search")');
  await admin.waitForSelector(`tbody tr:has-text("${v.name}")`);
  await admin.locator(`tbody tr:has-text("${v.name}") button:has-text("Edit")`).first().click();
  await admin.waitForSelector('[role=dialog]');
  await admin.fill('[role=dialog] label:has-text("Lead email") input', 'leads@newowner.example');
  await admin.selectOption('[role=dialog] label:has-text("Plan") select', 'featured');
  await admin.click('[role=dialog] button:has-text("Save vendor")');
  await admin.waitForSelector('[role=dialog] .form-error:has-text("renewal date")');
  await admin.fill('[role=dialog] input[type=date]', '2027-01-15');
  // Admins can fill in the category's details too.
  await admin.click('[role=dialog] .det-group >> nth=0 >> .det-head');
  const opt = admin.locator('[role=dialog] .det-group >> nth=0 >> .seg button').first();
  const label = (await opt.textContent()).trim();
  await opt.click();
  await admin.click('[role=dialog] button:has-text("Save vendor")');
  await toast(admin, /saved/);
  const [row] = await q(`select email, plan, plan_renews_at::text, details from vendors where id = $1`, [v.id]);
  assert.deepEqual({ email: row.email, plan: row.plan, plan_renews_at: row.plan_renews_at }, { email: 'leads@newowner.example', plan: 'featured', plan_renews_at: '2027-01-15' });
  assert.ok(Object.values(row.details).some((x) => Array.isArray(x) && x.includes(label)), `saved ${label}`);
});

test('vendors: filter by country, state and city alongside status, plan and category', async () => {
  await go(admin, 'vendors');
  const sel = (label) => admin.locator(`form label:has(span.sr-only:text-is("${label}")) select`);
  await admin.fill('input[type=search]', '');            // the previous test left a search in the box
  await admin.click('form button:has-text("Search")');
  await admin.waitForSelector('tbody tr td');
  const [{ n: all }] = await q(`select count(*)::int n from vendors`);
  await admin.waitForFunction((n) => document.querySelector('#vcount')?.textContent?.replace(/,/g, '') === String(n), all);
  const [{ n: tx }] = await q(`select count(*)::int n from vendors v join cities c on c.id = v.city_id join regions r on r.id = c.region_id where r.code = 'tx'`);
  const [{ id: texas }] = await q(`select id from regions where code = 'tx' and country_code = 'us'`);
  await sel('Country').selectOption('us');
  await admin.waitForFunction((n) => document.querySelector('#vcount')?.textContent?.replace(/,/g, '') === String(n), all);
  await sel('State').selectOption(String(texas));
  await admin.waitForFunction((n) => document.querySelector('#vcount')?.textContent?.replace(/,/g, '') === String(n), tx);
  // City list now only offers Texas cities.
  const cityNames = await sel('City').locator('option').allTextContents();
  const [{ n: txCities }] = await q(`select count(*)::int n from cities where region_id = $1`, [texas]);
  assert.equal(cityNames.length - 1, txCities);
  const [{ id: austin }] = await q(`select id from cities where name = 'Austin'`);
  await sel('City').selectOption(String(austin));
  const [{ n: inAustin }] = await q(`select count(*)::int n from vendors where city_id = $1`, [austin]);
  await admin.waitForFunction((n) => document.querySelector('#vcount')?.textContent?.replace(/,/g, '') === String(n), inAustin);
  const cities = await admin.locator('tbody tr td:nth-child(3)').allTextContents();
  assert.ok(cities.length > 0 && cities.every((c) => c.startsWith('Austin')), cities.join('|'));
  // Combines with category; Clear filters resets everything.
  const [{ id: venues }] = await q(`select id from categories where slug = 'wedding-venues'`);
  await sel('Category').selectOption(String(venues));
  const [{ n: austinVenues }] = await q(`select count(*)::int n from vendors where city_id = $1 and category_id = $2`, [austin, venues]);
  await admin.waitForFunction((n) => document.querySelector('#vcount')?.textContent?.replace(/,/g, '') === String(n), austinVenues);
  await admin.click('button:has-text("Clear filters")');
  await admin.waitForFunction((n) => document.querySelector('#vcount')?.textContent?.replace(/,/g, '') === String(n), all);
  assert.equal(await sel('State').inputValue(), '');
  assert.deepEqual(admin.errors ?? [], []);
});

test('claims: approve transfers ownership and the queue empties', async () => {
  await go(admin, 'vendors');
  await admin.click('.seg button:has-text("Claims")');
  await admin.waitForSelector('[aria-label^="Claim for"]');
  const [c] = await q(`select c.id, c.vendor_id, c.user_id, v.name from claims c join vendors v on v.id = c.vendor_id where c.status = 'pending' order by c.created_at limit 1`);
  const card = admin.locator(`[aria-label="Claim for ${c.name}"]`);
  assert.match(await card.innerText(), /verify by|matches the website/);
  await card.locator('button:has-text("Approve")').click();
  await toast(admin, /approved/);
  const [v] = await q(`select owner_id, status from vendors where id = $1`, [c.vendor_id]);
  assert.equal(v.owner_id, c.user_id);
  assert.equal(v.status, 'claimed');
});

test('CSV import: merges duplicates, reports bad rows, adds new vendors', async () => {
  const [dup] = await q(`select name, phone from vendors where source = 'sample' and phone is not null and category_id = (select id from categories where slug='florists') order by slug limit 1`);
  const csv = ['Business Name,Category,City,State,Phone,Website,Starting Price',
    `"Lone Star Blooms, LLC",florists,Austin,TX,(512) 555-0777,https://lonestarblooms.example,"$2,400"`,
    `${dup.name},Wedding florists,Austin,Texas,${dup.phone},,`,
    'Mystery Co,balloon artists,Austin,TX,,,',
    'Hill Top Farm,Wedding venues,Bee Cave,TX,512-555-0888,,9000'].join('\n');
  const file = path.join(os.tmpdir(), `import-${Date.now()}.csv`);
  fs.writeFileSync(file, csv);
  await go(admin, 'vendors');
  await admin.click('.seg button:has-text("Import CSV")');
  await admin.setInputFiles('input[type=file][accept*=csv]', file);
  await admin.waitForSelector('button:has-text("Import 4 rows")');
  await admin.click('button:has-text("Import 4 rows")');
  await admin.waitForSelector('[aria-label="Import result"]');
  const txt = await admin.locator('[aria-label="Import result"]').innerText();
  assert.match(txt, /New vendors\s*2/);
  assert.match(txt, /Duplicates merged\s*1/);
  assert.match(txt, /Row 3 \(Mystery Co\): unknown category/);
  const [n] = await q(`select price_from, name from vendors where website = 'https://lonestarblooms.example'`);
  assert.equal(n.name, 'Lone Star Blooms, LLC', 'quoted commas parsed correctly');
  assert.equal(n.price_from, 2400);
  assert.equal((await q(`select 1 from cities where slug = 'bee-cave'`)).length, 1, 'new city created');
});

test('reviews: approve updates the vendor rating', async () => {
  const [r] = await q(`select r.id, r.vendor_id from reviews r where status = 'pending' order by created_at limit 1`);
  await go(admin, 'reviews');
  await admin.waitForSelector('[aria-label^="Review by"]');
  const before = (await q(`select review_count from vendors where id = $1`, [r.vendor_id]))[0].review_count;
  await admin.locator('[aria-label^="Review by"]').first().locator('button:has-text("Approve")').click();
  await toast(admin, /published/);
  const after = (await q(`select review_count from vendors where id = $1`, [r.vendor_id]))[0].review_count;
  assert.equal(after, before + 1);
});

test('vendor categories: add, edit, reorder, hide; slug locks when used; cities and countries', async () => {
  await go(admin, 'taxonomy');
  await admin.click('button:has-text("+ Add category")');
  await admin.fill('label:has-text("Name (plural)") input', 'Mehndi artists');
  assert.equal(await admin.inputValue('label:has-text("Web address") input'), 'mehndi-artists');
  await admin.fill('label:has-text("Singular") input', 'Mehndi artist');
  await admin.click('button:has-text("Save category")');
  await toast(admin, /added/);
  const [m] = await q(`select id, active, budget_share::float from categories where slug = 'mehndi-artists'`);
  assert.equal(m.active, true);

  await admin.locator('button[aria-label="Move Mehndi artists up"]').click();
  await admin.waitForTimeout(400);
  const order = (await q(`select slug from categories order by sort, id`)).map((x) => x.slug);
  assert.ok(order.indexOf('mehndi-artists') < order.indexOf('photo-booths'), 'moved up');

  await admin.locator('tr:has-text("Photo booths") button:has-text("Shown")').click();
  await toast(admin, /hidden/);
  assert.equal((await q(`select active from categories where slug = 'photo-booths'`))[0].active, false);
  await admin.locator('tr:has-text("Photo booths") button:has-text("Hidden")').click();

  await admin.locator('tr:has-text("Wedding venues") button:has-text("Edit")').first().click();
  assert.equal(await admin.locator('label:has-text("Web address") input').isDisabled(), true, 'used category: address locked');
  // Category image: built-in illustration by default, upload a photo, then go back to the default.
  assert.match(await admin.locator('form[aria-label="Category editor"] img').getAttribute('src'), /\/img\/categories\/wedding-venues\.svg$/);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await admin.setInputFiles('input[aria-label="Upload category image"]', { name: 'venue.png', mimeType: 'image/png', buffer: png });
  await toast(admin, /Image uploaded/);
  await admin.fill('label:has-text("Image description") input', 'Garden ceremony at sunset');
  await admin.click('button:has-text("Save category")');
  await toast(admin, /saved/);
  let [cv] = await q(`select image_url, image_alt from categories where slug = 'wedding-venues'`);
  assert.match(cv.image_url, /\/storage\/v1\/object\/public\/blog-images\/categories\/wedding-venues-/);
  assert.equal(cv.image_alt, 'Garden ceremony at sunset');
  assert.equal((await fetch(cv.image_url)).status, 200);
  await admin.locator('tr:has-text("Wedding venues") button:has-text("Edit")').first().click();
  await admin.click('button:has-text("Use the default illustration")');
  await admin.click('button:has-text("Save category")');
  await admin.waitForSelector('form[aria-label="Category editor"]', { state: 'detached' });
  [cv] = await q(`select image_url, image_alt from categories where slug = 'wedding-venues'`);
  assert.deepEqual(cv, { image_url: null, image_alt: null });
  await admin.locator('tr:has-text("Wedding venues") button:has-text("Edit")').first().click();
  await admin.click('button:has-text("Cancel")');
  await admin.locator('tr:has-text("Mehndi artists") button:has-text("Delete")').click();
  await toast(admin, /deleted/);

  await admin.click('.seg button:has-text("Cities")');
  await admin.fill('label:has-text("City name") input', 'Georgetown');
  await admin.fill('label:has-text("Latitude") input', '30.6327');
  await admin.fill('label:has-text("Longitude") input', '-97.6772');
  await admin.click('button:has-text("Add city")');
  await toast(admin, /Georgetown added/);
  assert.equal((await q(`select lat from cities where slug = 'georgetown'`))[0].lat, 30.6327);

  await admin.selectOption('[aria-label="Add a state or region"] select', 'in');
  await admin.fill('[aria-label="Add a state or region"] label:has-text("Name") input', 'Puducherry Test Region');
  await admin.click('button:has-text("Add region")');
  await toast(admin, /Puducherry Test Region added/);
  assert.equal((await q(`select country_code from regions where name = 'Puducherry Test Region'`))[0].country_code, 'in');
  assert.ok((await q(`select count(*)::int n from regions where country_code = 'in'`))[0].n >= 36, 'India states are pre-loaded');

  await admin.click('.seg button:has-text("Countries")');
  await admin.fill('[aria-label="Add a country"] label:has-text("Country name") input', 'Singapore');
  await admin.fill('[aria-label="Add a country"] label:has-text("Code") input', 'sg');
  await admin.fill('[aria-label="Add a country"] label:has-text("Currency") input', 'sgd');
  await admin.click('button:has-text("Add country")');
  await toast(admin, /Singapore added/);
  const [sg] = await q(`select currency, active from countries where code = 'sg'`);
  assert.deepEqual({ ...sg }, { currency: 'SGD', active: false });
  await admin.locator('div:has(> .result:has-text("India")) button:has-text("Categories")').click();
  await admin.locator('[aria-label="Categories in India"] label:has-text("Wedding officiants") input').uncheck();
  await toast(admin, /officiants hidden in India/);
  assert.equal((await q(`select count(*)::int n from country_hidden_categories h join categories c on c.id = h.category_id where h.country_code = 'in' and c.slug = 'officiants'`))[0].n, 1);
  assert.equal((await q(`select count(*)::int n from country_hidden_categories where country_code = 'us'`))[0].n, 0, 'US unaffected');
  await admin.locator('.result:has-text("Canada") button:has-text("Off")').click();
  await toast(admin, /switched on/);
  assert.equal((await q(`select active from countries where code = 'ca'`))[0].active, true);
  await admin.locator('.result:has-text("Canada") button:has-text("Live")').click();
});

test('blog posts: visual editor writes Markdown, keeps formatting both ways, cleans pasted Docs text', async () => {
  await go(admin, 'posts');
  await admin.click('button:has-text("+ New post")');
  await admin.fill('label:has-text("Title") input', 'Visual editor check');
  assert.equal(await admin.getAttribute('.seg button:has-text("Visual")', 'aria-pressed'), 'true', 'visual editor is the default');
  const body = admin.locator('.rte-body');
  const md = async () => { await admin.click('.seg button:has-text("Markdown")'); const v = await admin.inputValue('textarea[placeholder^="## A heading"]'); return v; };

  // Write with the toolbar and shortcuts.
  await body.click();
  await admin.selectOption('.rte-select', 'h2');
  await admin.keyboard.type('Why barns');
  await admin.keyboard.press('Enter');
  await admin.keyboard.type('Rustic ');
  await admin.keyboard.press('Control+b'); await admin.keyboard.type('charm'); await admin.keyboard.press('Control+b');
  await admin.keyboard.type(' and space.');
  await admin.keyboard.press('Enter');
  await admin.click('.rte-btn[aria-label="Bulleted list"]');
  await admin.keyboard.type('Austin venues');
  await admin.keyboard.press('Shift+Home');
  await admin.click('.rte-btn[aria-label="Link (Ctrl+K)"]');
  await admin.fill('.rte-sub input', '/us/texas/austin/wedding-venues/');
  await admin.click('.rte-sub button:has-text("Apply")');
  let out = await md();
  assert.match(out, /^## Why barns$/m);
  assert.match(out, /Rustic \*\*charm\*\* and space\./);
  assert.match(out, /^- \[Austin venues\]\(\/us\/texas\/austin\/wedding-venues\/\)$/m);

  // Markdown -> visual -> Markdown keeps every kind of formatting.
  const rich = [
    '## Planning', '', 'Some *italic*, **bold**, ~~old~~ and `code` with a [guide](https://example.com/guide).', '',
    '![Barn at sunset](https://images.example.com/barn.jpg)', '', '1. First', '2. Second', '', '> A quote', '', '---', '',
    '| Venue | Guests |', '| --- | --- |', '| Hill Barn | 200 |', '', '### Costs', '', 'Line one  ', 'line two',
  ].join('\n');
  await admin.fill('textarea[placeholder^="## A heading"]', rich);
  await admin.click('.seg button:has-text("Visual")');
  assert.equal(await body.locator('table th').first().innerText(), 'Venue');
  assert.equal(await body.locator('img').getAttribute('alt'), 'Barn at sunset');
  assert.equal(await body.evaluate((el) => [...el.querySelectorAll(':scope > p')].filter((x) => !x.textContent.trim()).length), 0, 'no empty line above the image');
  await body.locator('h3').click();
  await admin.waitForTimeout(150);
  await admin.keyboard.press('End');
  await admin.keyboard.type(' and fees');
  await body.locator('img').click();
  await admin.fill('label:has-text("Image description") input', 'Red barn at sunset');
  out = await md();
  for (const want of [/^## Planning$/m, /Some \*italic\*, \*\*bold\*\*, ~~old~~ and `code` with a \[guide\]\(https:\/\/example\.com\/guide\)\./,
    /!\[Red barn at sunset\]\(https:\/\/images\.example\.com\/barn\.jpg\)/, /^1\. +First$/m, /^2\. +Second$/m, /^> A quote$/m, /^---$/m,
    /^\| Venue \| Guests \|$/m, /^\| Hill Barn \| 200 \|$/m, /^### Costs and fees$/m, /Line one  \nline two/]) assert.match(out, want, String(want));

  // Pasting from Google Docs keeps structure, drops fonts and colours.
  await admin.click('.seg button:has-text("Visual")');
  await body.locator('p').last().click();
  await admin.waitForTimeout(150);                       // the editor reads a click's position a moment later
  await admin.keyboard.press('End');
  await admin.keyboard.press('Enter');
  await admin.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-1"><h2 dir="ltr"><span style="font-size:16pt;font-family:Arial;color:#ff0000">Pasted heading</span></h2>'
      + '<p dir="ltr"><span style="font-size:11pt;font-family:Arial;font-weight:700">Bold bit</span><span style="font-size:11pt"> then plain.</span></p></b>');
    dt.setData('text/plain', 'Pasted heading\nBold bit then plain.');
    document.querySelector('.rte-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  out = await md();
  assert.match(out, /^## Pasted heading$/m);
  assert.match(out, /then plain\./);
  assert.doesNotMatch(out, /style=|font-|<span|Arial/);

  await admin.selectOption('label:has-text("Category") select', { label: 'Venues' });
  await admin.click('button:has-text("Save draft")');
  await toast(admin, /Draft saved/);
  const [row] = await q(`select body from posts where slug = 'visual-editor-check'`);
  assert.match(row.body, /^## Planning$/m);
  await q(`delete from posts where slug = 'visual-editor-check'`);
  assert.deepEqual(admin.errors, []);
});

test('blog posts: write with preview, schedule, publish, slug lock, delete', async () => {
  await go(admin, 'posts');
  assert.match(await admin.locator('.site-update').innerText(), /not set up yet.*open from their link right away/s, 'explains how posts go live');
  await admin.click('button:has-text("+ New post")');
  await admin.fill('label:has-text("Title") input', 'Best barn venues near Austin');
  assert.equal(await admin.inputValue('label:has-text("Web address") input'), 'best-barn-venues-near-austin');
  await admin.click('.seg button:has-text("Markdown")');
  await admin.fill('textarea[placeholder^="## A heading"]', '## Why barns\n\nRustic **charm** and <script>alert(1)</script> space.\n\n- [Austin venues](/us/texas/austin/wedding-venues/)');
  await admin.click('.seg button:has-text("Preview")');
  const html = await admin.locator('article.prose').innerHTML();
  assert.match(html, /<h2 id="why-barns">Why barns<\/h2>/);
  assert.match(html, /<strong>charm<\/strong>/);
  assert.match(html, /&lt;script&gt;/, 'raw HTML is shown as text, never run');
  await admin.selectOption('label:has-text("Category") select', { label: 'Venues' });
  await admin.fill('aside label:has-text("City") input', 'Austin, TX');
  await admin.locator('aside label:has-text("City") input').dispatchEvent('change');
  await admin.fill('input[type=datetime-local]', '2020-01-01T10:00');
  await admin.click('button:has-text("Schedule")');
  await admin.waitForSelector('.form-error:has-text("future")');
  await admin.fill('input[type=datetime-local]', '2030-06-01T10:00');
  await admin.click('button:has-text("Schedule")');
  await toast(admin, /Scheduled/);
  let [p] = await q(`select id, status, city_id, category_id from posts where slug = 'best-barn-venues-near-austin'`);
  assert.equal(p.status, 'scheduled');
  assert.ok(p.city_id, 'linked to a city for "Planning guides"');

  await admin.locator('tr:has-text("Best barn venues") button:has-text("Edit")').click();
  await admin.click('button:has-text("Publish now")');
  await toast(admin, /Published/);
  [p] = await q(`select status, published_at <= now() live from posts where slug = 'best-barn-venues-near-austin'`);
  assert.equal(p.status, 'published');
  assert.equal(p.live, true);
  assert.equal(await admin.locator('tr:has-text("Best barn venues") a:has-text("View")').getAttribute('href'), '/blog/best-barn-venues-near-austin/', 'published posts link to the live page');
  assert.equal(await admin.locator('tr:has-text("20 questions to ask") a:has-text("View")').count(), 0, 'drafts have no link');

  await admin.locator('tr:has-text("Best barn venues") button:has-text("Edit")').click();
  assert.equal(await admin.locator('label:has-text("Web address") input').isDisabled(), true, 'live post: address locked');
  await admin.click('button:has-text("Delete post")');
  await toast(admin, /deleted/);
  assert.equal((await q(`select 1 from posts where slug = 'best-barn-venues-near-austin'`)).length, 0);
  assert.deepEqual(admin.errors, []);
});

test('blog categories: create, rename, hide, delete with "move posts to"', async () => {
  await go(admin, 'blog-categories');
  await admin.click('button:has-text("+ Add category")');
  await admin.fill('label:has-text("Name") input >> nth=0', 'Honeymoons');
  await admin.fill('label:has-text("Description") textarea', 'Where to go after the big day.');
  await admin.click('button:has-text("Save category")');
  await toast(admin, /added/);
  await admin.locator('tr:has-text("Honeymoons") button:has-text("Edit")').click();
  await admin.fill('label:has-text("Name") input >> nth=0', 'Honeymoons & travel');
  await admin.click('button:has-text("Save category")');
  await toast(admin, /saved/);
  assert.equal((await q(`select name, slug from blog_categories where slug = 'honeymoons'`))[0].name, 'Honeymoons & travel', 'renamed, address kept');

  await admin.locator('tr:has-text("Budget & costs") button:has-text("Delete")').click();
  await admin.click('button:has-text("Move posts and delete")');
  await toast(admin, /Choose where/);
  await admin.selectOption('[role=dialog] select', { label: 'Honeymoons & travel' });
  await admin.click('button:has-text("Move posts and delete")');
  await toast(admin, /Moved 1 post/);
  const [post] = await q(`select bc.slug from posts p join blog_categories bc on bc.id = p.category_id where p.slug = 'how-much-does-a-wedding-venue-cost-in-austin'`);
  assert.equal(post.slug, 'honeymoons');
});

test('analytics: visitors, sources, funnel and lead attribution from the site\'s own tracking', async () => {
  await q(`delete from events where visitor_id like 'e2evis%'`);
  const hit = (p) => q('select track_hit($1::jsonb)', [JSON.stringify(p)]);
  for (let i = 0; i < 3; i++) await hit({ kind: 'page_view', path: '/blog/e2e-analytics/', vid: `e2evis00${i}`, sid: `e2eses00${i}`, ref: 'www.google.com', dev: 'mobile' });
  await hit({ kind: 'lead_start', path: '/get-matched/', vid: 'e2evis000', sid: 'e2eses000' });
  await hit({ kind: 'lead', path: '/get-matched/', vid: 'e2evis000', sid: 'e2eses000' });
  await go(admin, 'analytics');
  await admin.locator('.kpi').first().waitFor();
  const kpi = async (label) => Number((await admin.locator(`.kpi:has(span:text-is("${label}")) b`).innerText()).replace(/,/g, ''));
  assert.ok(await kpi('Visitors') >= 3);
  const search = admin.locator('section:has(h2:text-is("Where visits come from")) tr:has(td b:text-is("Search"))');
  assert.ok(Number(await search.locator('td').nth(1).innerText()) >= 3);
  assert.ok(Number(await search.locator('td').nth(2).innerText()) >= 1, 'the lead is credited to search');
  assert.ok(await admin.locator('section:has(h2:text-is("Top pages")) tbody tr').count() > 0);
  assert.match(await admin.locator('section:has(h2:text-is("Lead funnel"))').innerText(), /Sent a request\s*[1-9]/);
  await admin.screenshot({ path: process.env.SHOT ?? '/dev/null', fullPage: true }).catch(() => {});
  await admin.selectOption('select:near(:text("Range"))', '7');
  await admin.locator('.kpi').first().waitFor();
  assert.deepEqual(admin.errors ?? [], []);
});

test('blog posts: comment counts open a quick view of that post\'s comments', async () => {
  await go(admin, 'posts');
  const [{ pending }] = await q(`select count(*)::int pending from comments where post_id = '00000000-0000-0000-0000-0000000b1001' and status = 'pending'`);
  assert.ok(pending > 0, 'fixture has comments waiting');
  const btn = admin.locator(`button[aria-label*="${pending} waiting"]`).first();
  await btn.click();
  const qv = admin.locator('.qv[role=dialog]');
  await qv.waitFor();
  await qv.locator('[aria-label^="Comment by"]').first().waitFor();
  assert.equal(await qv.locator('[aria-label^="Comment by"]').count(), pending);
  assert.equal(await qv.locator('select').count(), 0, 'no post filter inside the quick view');
  await admin.keyboard.press('Escape');
  await qv.waitFor({ state: 'detached' });
});

test('comments: bulk spam, approve, admin reply goes live', async () => {
  await go(admin, 'comments');
  await admin.waitForSelector('[aria-label^="Comment by"]');
  await admin.locator('[aria-label="Comment by Cheap Pills"] input[type=checkbox]').check();
  await admin.click('button:has-text("Spam selected")');
  await toast(admin, /1 comment marked as spam/);
  await admin.locator('[aria-label="Comment by Sam"] button:has-text("Reply")').click();
  await admin.fill('[aria-label="Comment by Sam"] textarea', 'Good question! Most venues price catering separately.');
  await admin.click('button:has-text("Publish reply")');
  await toast(admin, /Reply published/);
  const rows = await q(`select author_name, status, is_staff, parent_id is not null as is_reply from comments where post_id = '00000000-0000-0000-0000-0000000b1001' order by created_at`);
  const byName = Object.fromEntries(rows.map((r) => [r.author_name + (r.is_staff ? '*' : ''), r]));
  assert.equal(byName['Cheap Pills'].status, 'spam');
  assert.equal(byName['Sam'].status, 'approved', 'replying approves the comment');
  const staff = rows.find((r) => r.is_staff);
  assert.equal(staff.status, 'approved');
  assert.equal(staff.is_reply, true);
  assert.equal((await q(`select count(*)::int n from comments where status = 'pending'`))[0].n, 0);
});

test('team: make someone an editor', async () => {
  await go(admin, 'team');
  await admin.fill('input[type=email]', 'dana@vendor.local');
  await admin.selectOption('label:has-text("Access") select', 'editor');
  await admin.click('button:has-text("Save access")');
  await toast(admin, /now an editor/);
  assert.equal((await q(`select p.role from profiles p join auth.users u on u.id = p.id where u.email = 'dana@vendor.local'`))[0].role, 'editor');
  await admin.selectOption('label:has-text("Access") select', 'vendor');
  await admin.fill('input[type=email]', 'dana@vendor.local');
  await admin.click('button:has-text("Save access")');
  await toast(admin, /regular user/);
});

test('admin works on a phone screen', async () => {
  const p = await signedIn('admin@bloomvow.local');
  await p.setViewportSize({ width: 390, height: 844 });
  for (const r of ['overview', 'leads', 'vendors', 'taxonomy', 'posts', 'comments']) {
    await go(p, r);
    await p.waitForTimeout(300);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `#${r} is ${w}px wide`);
  }
  await p.context().close();
});

test('page content editor: find a page, write intro/guide/FAQ with preview and length warning, filter, CSV import', async () => {
  const ed = await signedIn('writer@bloomvow.local');
  await go(ed, 'pages');
  await ed.waitForSelector('.tbl tbody tr');
  await ed.fill('input[aria-label="Search pages"]', 'photographers in Austin');
  await ed.click('.tbl tbody tr:has-text("Wedding photographers in Austin, TX") button:has-text("Edit")');
  await ed.waitForSelector('form[aria-label="Edit page content"]');
  await ed.fill('textarea[name=intro]', 'x'.repeat(360));
  await ed.locator('.form-error:has-text("Too long")').waitFor();
  await ed.fill('textarea[name=intro]', 'Austin photographers who know the Hill Country light.');
  await ed.fill('textarea[name=body]', '## Prices\n\nMost start at $3,000.\n\n## Styles\n\nDocumentary or editorial.\n\n## Tips\n\n- Book early');
  await ed.click('.seg button:has-text("Preview")');
  await ed.locator('.preview-box h2#prices').waitFor();
  assert.match(await ed.locator('.preview-box').innerText(), /Table of contents: Prices · Styles · Tips/);
  await ed.click('button:has-text("+ Add FAQ")');
  await ed.fill('input[aria-label="Question 1"]', 'Do Austin photographers travel?');
  await ed.click('button.btn-primary:has-text("Save")');
  await ed.locator('.form-error:has-text("both a question and an answer")').waitFor();
  await ed.fill('textarea[aria-label="Answer 1"]', 'Most include travel within 30 miles.');
  await ed.fill('input[name=seo_title]', 'Austin Wedding Photographers');
  await ed.click('button.btn-primary:has-text("Save")');
  await toast(ed, /Saved/);
  const [row] = await q(`select intro, body, faqs, seo_title, updated_by is not null as by from page_content where path = '/us/texas/austin/photographers/'`);
  assert.equal(row.intro, 'Austin photographers who know the Hill Country light.');
  assert.match(row.body, /## Styles/);
  assert.deepEqual(row.faqs, [{ q: 'Do Austin photographers travel?', a: 'Most include travel within 30 miles.' }]);
  assert.equal(row.by, true);

  await ed.fill('input[aria-label="Search pages"]', '');
  await ed.selectOption('select[aria-label="Custom content"]', 'custom');
  const titles = await ed.locator('.tbl tbody tr td:first-child b').allInnerTexts();
  assert.deepEqual(titles.sort(), ['Wedding photographers in Austin, TX', 'Wedding venues in Austin, TX']);

  const csv = 'path,intro,faqs\n/us/texas/dallas/,Dallas weddings: big venues and bigger skylines.,Is Dallas expensive? | Venues start around $5k || When to book? | 12 months ahead\n/nope/,x,\n';
  await ed.setInputFiles('input[type=file][accept=".csv,text/csv"]', { name: 'pages.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await toast(ed, /Imported 1 page; skipped 1 unknown: \/nope\//);
  const [dal] = await q(`select intro, faqs from page_content where path = '/us/texas/dallas/'`);
  assert.equal(dal.intro, 'Dallas weddings: big venues and bigger skylines.');
  assert.equal(dal.faqs.length, 2);
  assert.deepEqual(ed.errors ?? [], []);
  await ed.context().close();
});

test('SEO files: edit robots.txt with checks, blocking the site needs a second click, reset to default', async () => {
  await go(admin, 'seo');
  const box = admin.locator('textarea[aria-label="robots.txt contents"]');
  assert.match(await box.inputValue(), /^User-agent: \*\nAllow: \/\nDisallow: \/vendor-dashboard\//, 'starts with the default');
  await box.fill('User-agent: *\nDisalow: /private/');
  await admin.locator('.form-error li:has-text("Line 2")').waitFor();
  assert.equal(await admin.locator('button:has-text("Save robots.txt")').isDisabled(), true);
  await box.fill('# Custom\nUser-agent: *\nAllow: /\nDisallow: /drafts/');
  await admin.click('button:has-text("Save robots.txt")');
  await toast(admin, /next site update/);
  assert.equal((await q(`select value from settings where key = 'robots_txt'`))[0].value, '# Custom\nUser-agent: *\nAllow: /\nDisallow: /drafts/');
  await box.fill('User-agent: *\nDisallow: /');
  await admin.locator('text=drop out of Google').waitFor();
  await admin.click('button:has-text("Save robots.txt")');
  await admin.locator('text=This would remove the whole site from Google').waitFor();
  assert.match((await q(`select value from settings where key = 'robots_txt'`))[0].value, /drafts/, 'not saved after one click');
  await admin.click('button:has-text("Reset to default")');
  await admin.click('button:has-text("Save robots.txt")');
  await toast(admin, /Back to the default/);
  assert.equal((await q(`select value from settings where key = 'robots_txt'`))[0].value, '');
  assert.deepEqual(admin.errors, []);
});
