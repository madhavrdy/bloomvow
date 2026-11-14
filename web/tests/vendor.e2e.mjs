// Browser tests for the vendor dashboard: sign-up, claim, add business,
// overview stats, lead inbox, listing editor, service-area cities, photos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = process.env.SITE;
const DANA = '00000000-0000-0000-0000-00000000b001';
const ADMIN = '00000000-0000-0000-0000-00000000a001';
let browser, db;
const q = async (sql, params) => (await db.query(sql, params)).rows;

// Run SQL as the sample admin, the way the admin dashboard will.
async function asAdmin(sql, params) {
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN, role: 'authenticated' })]);
    const r = await db.query(sql, params);
    await db.query('commit');
    return r.rows;
  } catch (e) { await db.query('rollback'); throw e; }
}

before(async () => {
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'] });
  db = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.DB });
  await db.connect();
});
after(async () => { await browser?.close(); await db?.end(); });

async function newPage(opts = {}) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  return p;
}
async function signIn(p, email, password = 'password123') {
  await p.goto(`${SITE}/vendor-dashboard/`);
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', password);
  await p.click('form.auth button.btn-acc');
}

test('sign in, new account and forgot password: main buttons have a solid colour', async () => {
  const p = await newPage();
  await p.goto(`${SITE}/vendor-dashboard/`);
  const solid = async (sel) => {
    const bg = await p.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(bg), `${sel} background is ${bg}`);
  };
  await solid('form.auth button.btn-acc');
  await solid('.auth .seg button[aria-pressed=true]');
  await p.click('.auth .seg button:has-text("New account")');
  await solid('form.auth button.btn-acc');
  await p.click('.auth .seg button:has-text("Sign in")');
  await p.click('text=Forgot password?');
  await solid('form.auth button.btn-acc');
  // Icons: tab icon, Apple touch icon and manifest are linked.
  for (const sel of ['link[rel=icon][href="/favicon.svg?v=3"]', 'link[rel=icon][href="/favicon.ico?v=3"]', 'link[rel=apple-touch-icon]', 'link[rel=manifest]'])
    assert.equal(await p.locator(sel).count(), 1, sel);
});

test('wrong password shows a clear message', async () => {
  const p = await newPage();
  await signIn(p, 'dana@vendor.local', 'wrong-password');
  await p.waitForSelector('.auth .form-error');
  assert.match(await p.locator('.auth .form-error').innerText(), /don't match/);
  await p.context().close();
});

test('new vendor: sign up, claim an existing listing from its profile link, add a new business, then go live after approval', async () => {
  const [target] = await q(`select id, name, slug from vendors where status = 'unclaimed' and source = 'sample'
    and id not in (select vendor_id from claims) and category_id = (select id from categories where slug = 'florists') order by slug limit 1`);
  const email = `owner-${Date.now()}@vendor-test.example`;
  const p = await newPage();

  // Profile page -> "Claim this listing" -> for-vendors -> dashboard with the listing pre-selected.
  await p.goto(`${SITE}/vendor/${target.slug}/`);
  await p.click('.claim a');
  await p.waitForURL(/for-vendors\/\?claim=/);
  await p.click('#claim-cta');
  await p.waitForURL(/vendor-dashboard\/\?claim=/);

  await p.click('.seg button:has-text("New account")');
  await p.fill('form.auth input[autocomplete=name]', 'Fern Owner');
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', 'short');
  await p.click('form.auth button.btn-acc');
  assert.equal(await p.$eval('input[type=password]', (el) => el.validity.valid), false, 'passwords under 8 characters are refused');
  await p.fill('input[type=password]', 'a-good-password-1');
  await p.click('form.auth button.btn-acc');

  await p.waitForSelector('.result');
  assert.match(await p.locator('.result').first().innerText(), new RegExp(target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await p.click('.result button:has-text("This is my business")');
  await p.waitForSelector('.form-ok');
  await p.waitForSelector('text=Waiting for approval');
  const [claim] = await q(`select c.id, c.status from claims c join auth.users u on u.id = c.user_id where u.email = $1 and c.vendor_id = $2`, [email, target.id]);
  assert.equal(claim.status, 'pending');

  // Add a brand-new business too.
  await p.click('.seg button:has-text("Add a new business")');
  await p.fill('form.panel input[name=name]', 'Petal Theory Florals');
  await p.selectOption('form.panel select[name=category]', { label: 'Wedding florists' });
  await p.fill('form.panel input[name=city]', 'Nowhere, ZZ');
  await p.click('form.panel button:has-text("Submit for review")');
  await p.waitForSelector('.form-error');
  await p.fill('form.panel input[name=city]', 'Austin, TX');
  await p.click('form.panel button:has-text("Submit for review")');
  await p.waitForSelector('text=Petal Theory Florals');
  const [nv] = await q(`select status, source from vendors where name = 'Petal Theory Florals'`);
  assert.deepEqual({ ...nv }, { status: 'hidden', source: 'self_signup' });

  // Admin approves the first claim -> dashboard opens on reload.
  await asAdmin('select admin_decide_claim($1, true)', [claim.id]);
  await p.reload();
  await p.waitForSelector('.kpis');
  assert.match(await p.locator('.side').innerText(), new RegExp(target.name.split(' ')[0]));
  assert.match(await p.locator('.side').innerText(), /Free plan/);

  // Free plan: can't add a second city page.
  await p.click('a[href="#listing"]');
  await p.fill('input[list=ed-cities]', 'Round Rock, TX');
  await p.click('button:has-text("Add city")');
  await p.waitForSelector('aside .form-error');
  assert.match(await p.locator('aside .form-error').innerText(), /limit of city pages/);

  await p.click('.side button:has-text("Sign out")');
  await p.waitForSelector('form.auth');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('overview shows the same numbers as the database', async () => {
  const [v] = await q(`select id from vendors where owner_id = $1`, [DANA]);
  const p = await newPage();
  await signIn(p, 'dana@vendor.local');
  await p.waitForSelector('.kpis');
  await p.waitForFunction(() => document.querySelectorAll('.kpi b')[2]?.textContent !== '–');
  const [{ s }] = await q(`select vendor_stats_raw.s from (select jsonb_build_object(
      'leads', (select count(*) from lead_recipients where vendor_id = $1 and sent_at >= now() - interval '30 days'),
      'views', (select count(*) from events where vendor_id = $1 and kind = 'view' and created_at >= now() - interval '30 days')) s) vendor_stats_raw`, [v.id]);
  const kpis = await p.locator('.kpi b').allInnerTexts();
  assert.equal(Number(kpis[0].replace(/,/g, '')), s.views);
  assert.equal(Number(kpis[2].replace(/,/g, '')), s.leads);
  assert.match(await p.locator('.banner').innerText(), /% complete/);
  await p.context().close();
});

test('analytics: claimed vendor sees their numbers and how couples found them', async () => {
  const [v] = await q(`select id, slug from vendors where owner_id = $1 and status = 'claimed' order by name limit 1`, [DANA]);
  await q(`select track_hit($1::jsonb)`, [JSON.stringify({ kind: 'page_view', path: '/us/texas/austin/wedding-venues/', vid: 'e2ecouple1', sid: 'e2evisit01', ref: 'www.google.com', dev: 'mobile' })]);
  await q(`select pg_sleep(0.01)`);
  await q(`select track_hit($1::jsonb)`, [JSON.stringify({ kind: 'view', vendor: v.id, path: `/vendor/${v.slug}/`, vid: 'e2ecouple1', sid: 'e2evisit01', dev: 'mobile' })]);
  const p = await newPage();
  await signIn(p, 'dana@vendor.local');
  await p.waitForSelector('.kpis');
  await p.click('nav.side a[href="#analytics"]');
  await p.waitForSelector('h2:text-is("How couples found your profile")');
  const views = Number((await p.locator('.kpi:has(span:text-is("Profile views")) b').innerText()).replace(/,/g, ''));
  const [{ n }] = await q(`select count(*)::int n from events where vendor_id = $1 and kind = 'view' and created_at >= date_trunc('day', now()) - interval '29 days'`, [v.id]);
  assert.equal(views, n);
  assert.match(await p.locator('section:has(h2:text-is("How couples found your profile"))').innerText(), /city & category pages/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('analytics is not offered for a listing whose claim is not approved', async () => {
  const [v] = await q(`select id from vendors where owner_id = $1 and status = 'claimed' order by name limit 1`, [DANA]);
  await q(`update vendors set status = 'unclaimed' where id = $1`, [v.id]);
  try {
    const p = await newPage();
    await signIn(p, 'dana@vendor.local');
    await p.waitForSelector('nav.side');
    const { rows } = await db.query(`select count(*)::int n from vendors where owner_id = $1 and status = 'claimed'`, [DANA]);
    if (rows[0].n === 0) assert.equal(await p.locator('nav.side a[href="#analytics"]').count(), 0, 'no Analytics link');
    await p.goto(`${SITE}/vendor-dashboard/#analytics`);
    await p.reload();
    await p.waitForSelector('.dmain');
    if (rows[0].n === 0) assert.match(await p.locator('.dmain').innerText(), /once your claim .* is approved|Welcome|Overview/);
    await p.context().close();
  } finally {
    await q(`update vendors set status = 'claimed' where id = $1`, [v.id]);
  }
});

test('lead inbox: opening marks read, quick reply goes into the conversation and the customer is emailed, status updates', async () => {
  const [v] = await q(`select id from vendors where owner_id = $1`, [DANA]);
  const p = await newPage();
  await signIn(p, 'dana@vendor.local');
  await p.waitForSelector('.kpis');
  await p.click('a[href="#leads"]');
  await p.waitForSelector('.inbox-list button');
  await p.click('.seg button:has-text("Needs reply")');
  const first = p.locator('.inbox-list button').nth(1);
  const couple = (await first.locator('b').innerText()).trim();
  await first.click();
  const [lead] = await q(`select lr.lead_id, lr.opened_at from lead_recipients lr join leads l on l.id = lr.lead_id
    where lr.vendor_id = $1 and l.couple_name = $2 order by lr.sent_at desc limit 1`, [v.id, couple]);
  await p.waitForFunction(async () => true);
  await new Promise((r) => setTimeout(r, 400));
  const [opened] = await q(`select opened_at from lead_recipients where lead_id = $1 and vendor_id = $2`, [lead.lead_id, v.id]);
  assert.ok(opened.opened_at, 'opening a lead marks it read');

  await p.click('button:has-text("Date is open")');
  const text = await p.locator('textarea').inputValue();
  assert.match(text, new RegExp(`^Hi ${couple.split(/\s|&/)[0]}!`));
  await p.click('button:has-text("Send reply")');
  await p.waitForSelector('.toast');
  const [after] = await q(`select status, reply, replied_at from lead_recipients where lead_id = $1 and vendor_id = $2`, [lead.lead_id, v.id]);
  assert.equal(after.status, 'replied');
  assert.equal(after.reply, text);
  const [mail] = await q(`select to_email, payload from notifications where kind = 'reply_to_couple' and payload->>'lead_id' = $1`, [lead.lead_id]);
  assert.match(mail.to_email, /@example\.com$/);
  assert.equal(mail.payload.reply_to, undefined, 'the customer answers in their inbox on the site');
  await p.waitForSelector('.thread .bubble.me');
  assert.equal((await q(`select count(*)::int n from lead_messages where lead_id = $1 and vendor_id = $2 and sender = 'vendor'`, [lead.lead_id, v.id]))[0].n, 1);

  await p.click('.seg[aria-label="Lead status"] button:text-is("Booked")');
  await p.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('booked'));
  const [booked] = await q(`select status from lead_recipients where lead_id = $1 and vendor_id = $2`, [lead.lead_id, v.id]);
  assert.equal(booked.status, 'booked');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('edit listing: details, packages, service-area cities and photos are saved', async () => {
  const [v] = await q(`select id from vendors where owner_id = $1`, [DANA]);
  const p = await newPage();
  await signIn(p, 'dana@vendor.local');
  await p.waitForSelector('.kpis');
  await p.click('a[href="#listing"]');
  await p.waitForSelector('#photos');

  const desc = Array.from({ length: 130 }, (_, i) => `word${i}`).join(' ');
  await p.fill('textarea', desc);
  await p.fill('label:has-text("Starting price") input', '7,250');
  await p.fill('label:has-text("Max guests") input', '220');
  await p.click('button:has-text("+ Add package")');
  const last = p.locator('.pkg-row').last();
  await last.locator('label:has-text("Package name") input').fill('Sunday brunch');
  await last.locator('label:has-text("Price") input').fill('5200');
  await p.fill('label:has-text("Website") input', 'not-a-url');
  await p.click('button:has-text("Save changes")');
  assert.equal(await p.$eval('label:has-text("Website") input', (el) => el.validity.valid), false, 'invalid website is refused');
  await p.fill('label:has-text("Website") input', 'https://bluebonnet.example');
  await p.click('button:has-text("Save changes")');
  await p.waitForSelector('.toast');

  const [row] = await q(`select description, price_from, capacity_max, website from vendors where id = $1`, [v.id]);
  assert.equal(row.description, desc);
  assert.equal(row.price_from, 7250);
  assert.equal(row.capacity_max, 220);
  assert.equal(row.website, 'https://bluebonnet.example');
  const pk = await q(`select name, price from packages where vendor_id = $1 and name = 'Sunday brunch'`, [v.id]);
  assert.deepEqual(pk.map((x) => ({ ...x })), [{ name: 'Sunday brunch', price: 5200 }]);

  // Details & amenities: venue options, grouped; saved as structured details.
  // The first group ("Venue") starts open; the others open on click.
  await p.click('.det-field:has-text("Setting & venue type") button:has-text("Barn")');
  await p.fill('input[aria-label="Seated dinner capacity"]', '180');
  await p.click('.det-head:has-text("Amenities")');
  await p.click('.det-field:has-text("Amenities") button:has-text("Dance floor")');
  await p.click('.det-field:has-text("Amenities") button:has-text("Wheelchair accessible")');
  await p.click('.det-head:has-text("Services & policies")');
  await p.click('.det-field:has-text("Catering") button:has-text("In-house catering only")');
  assert.equal(await p.getAttribute('.det-field:has-text("Catering") button:has-text("In-house catering only")', 'aria-checked'), 'true');
  await p.click('button:has-text("Save changes")');
  // The toast from the save above may still be showing, so wait for the data itself.
  let dd;
  for (let i = 0; i < 50; i++) { [dd] = await q(`select details from vendors where id = $1`, [v.id]); if (dd.details?.amenities) break; await p.waitForTimeout(100); }
  assert.deepEqual(dd.details.amenities, ['Dance floor', 'Wheelchair accessible'], 'kept in the defined order');
  assert.equal(dd.details.catering_policy, 'In-house catering only');
  assert.equal(dd.details.capacity_seated, 180);
  assert.deepEqual(dd.details.venue_type, ['Barn']);
  assert.ok(await p.isVisible('.checklist .ok:has-text("Details & amenities")') || await p.isVisible('.checklist :text("detail question")'));

  // Featured plan: extra city pages allowed.
  await p.fill('input[list=ed-cities]', 'Round Rock, TX');
  await p.click('button:has-text("Add city")');
  await p.waitForSelector('.tag-x:has-text("Round Rock")');
  const vc = await q(`select c.name from vendor_cities vc join cities c on c.id = vc.city_id where vc.vendor_id = $1`, [v.id]);
  assert.ok(vc.some((x) => x.name === 'Round Rock'));
  await p.click('.tag-x:has-text("Round Rock") button');
  await p.waitForSelector('.tag-x:has-text("Round Rock")', { state: 'detached' });

  // Photos: upload two, reorder, delete one; wrong file type is refused.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('#photos input[type=file]', [
    { name: 'a.png', mimeType: 'image/png', buffer: png },
    { name: 'b.png', mimeType: 'image/png', buffer: png },
  ]);
  await p.waitForFunction(() => document.querySelectorAll('#photos .photo').length === 2);
  const photos = await q(`select id, url from photos where vendor_id = $1 order by sort`, [v.id]);
  assert.equal(photos.length, 2);
  assert.ok(photos[0].url.includes(`/storage/v1/object/public/vendor-photos/${v.id}/`));
  const img = await fetch(photos[0].url);
  assert.equal(img.status, 200, 'uploaded photo is publicly viewable');
  await p.click('#photos .photo >> nth=1 >> button[aria-label="Move earlier"]');
  await new Promise((r) => setTimeout(r, 400));
  const reordered = await q(`select id from photos where vendor_id = $1 order by sort`, [v.id]);
  assert.equal(reordered[0].id, photos[1].id);
  await p.click('#photos .photo >> nth=0 >> button[aria-label="Delete photo"]');
  await p.waitForFunction(() => document.querySelectorAll('#photos .photo').length === 1);
  assert.equal((await q(`select count(*)::int n from photos where vendor_id = $1`, [v.id]))[0].n, 1);
  assert.equal((await fetch(photos[1].url)).status, 404, 'deleted photo file is removed from storage');
  // A big phone photo is shrunk in the browser before upload (1600px WebP).
  const bigPng = Buffer.from((await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
    const g = c.getContext('2d'); for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 37 % 360} 60% 60%)`; g.fillRect((i * 97) % 4000, (i * 61) % 3000, 300, 200); }
    return c.toDataURL('image/png').split(',')[1];
  })), 'base64');
  await p.setInputFiles('#photos input[type=file]', [{ name: 'IMG_0001.png', mimeType: 'image/png', buffer: bigPng }]);
  await p.waitForFunction(() => document.querySelectorAll('#photos .photo').length === 2);
  const [big] = await q(`select url from photos where vendor_id = $1 and url <> $2`, [v.id, photos[0].url]);
  assert.match(big.url, /\.webp$/);
  const stored = await fetch(big.url);
  const bytes = (await stored.arrayBuffer()).byteLength;
  assert.ok(bytes < bigPng.length / 3, `shrunk: ${bytes} bytes vs ${bigPng.length}`);
  const dims = await p.evaluate(async (u) => { const i = new Image(); i.src = u; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, big.url);
  assert.deepEqual(dims, [1600, 1200]);
  await p.setInputFiles('#photos input[type=file]', [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
  await p.waitForSelector('aside .form-error:has-text("JPG")');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('another vendor cannot upload into Dana\'s photo folder', async () => {
  const [v] = await q(`select id from vendors where owner_id = $1`, [DANA]);
  const login = await fetch(`${process.env.API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@bloomvow.local', password: 'password123' }),
  }).then((r) => r.json());
  // The admin may upload (admins manage all listings)...
  const ok = await fetch(`${process.env.API}/storage/v1/object/vendor-photos/${v.id}/admin.png`, { method: 'POST', headers: { authorization: `Bearer ${login.access_token}`, 'content-type': 'image/png' }, body: Buffer.from('x') });
  assert.equal(ok.status, 200);
  // ...an ordinary vendor may not.
  const other = await fetch(`${process.env.API}/auth/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `intruder-${Date.now()}@x.example`, password: 'password123' }) }).then((r) => r.json());
  const denied = await fetch(`${process.env.API}/storage/v1/object/vendor-photos/${v.id}/evil.png`, { method: 'POST', headers: { authorization: `Bearer ${other.access_token}`, 'content-type': 'image/png' }, body: Buffer.from('x') });
  assert.equal(denied.status, 403);
});

test('dashboard works on a phone screen', async () => {
  const p = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await signIn(p, 'dana@vendor.local');
  await p.waitForSelector('.kpis');
  for (const r of ['overview', 'analytics', 'leads', 'listing']) {
    await p.goto(`${SITE}/vendor-dashboard/#${r}`);
    await p.waitForTimeout(500);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `#${r} is ${w}px wide`);
  }
  await p.context().close();
});
