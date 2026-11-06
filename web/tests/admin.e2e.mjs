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
  const [c] = await q(`select count(*)::int clicks from events where created_at >= now() - interval '14 days' and kind in ('click_phone','click_website','click_directions')`);
  const k = await admin.locator('.kpi b').allInnerTexts();
  assert.equal(Number(k[0].replace(/,/g, '')), s.leads);
  assert.equal(Number(k[2].replace(/,/g, '')), c.clicks);
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
  await admin.click('[role=dialog] button:has-text("Save vendor")');
  await toast(admin, /saved/);
  const [row] = await q(`select email, plan, plan_renews_at::text from vendors where id = $1`, [v.id]);
  assert.deepEqual({ ...row }, { email: 'leads@newowner.example', plan: 'featured', plan_renews_at: '2027-01-15' });
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

test('blog posts: write with preview, schedule, publish, slug lock, delete', async () => {
  await go(admin, 'posts');
  await admin.click('button:has-text("+ New post")');
  await admin.fill('label:has-text("Title") input', 'Best barn venues near Austin');
  assert.equal(await admin.inputValue('label:has-text("Web address") input'), 'best-barn-venues-near-austin');
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
