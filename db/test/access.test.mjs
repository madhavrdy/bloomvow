import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor, makeUser, cityId, catId, lead } from './helpers.mjs';

let db, austin, venues, admin, alice, bob, va, vb, leadId;

before(async () => {
  db = await freshDb('bv_test_access');
  austin = await cityId(db, 'Austin');
  venues = await catId(db, 'wedding-venues');
  admin = await makeUser(db, 'admin@bloomvow.test', 'admin');
  alice = await makeUser(db, 'alice@cedarhollow.example');
  bob = await makeUser(db, 'bob@gmail.com');
  va = await makeVendor(db, { name: 'Cedar Hollow', owner_id: alice, status: 'claimed', email: 'alice@cedarhollow.example', website: 'https://www.cedarhollow.example/' });
  vb = await makeVendor(db, { name: 'Bob Barn', owner_id: bob, status: 'claimed', email: 'bob@gmail.com' });
  const r = await db.anon('select submit_lead($1::jsonb) as r', [JSON.stringify(lead({ source: 'profile', vendor_id: va.id, city_id: austin }))]);
  leadId = r[0].r.lead_id;
});
after(() => db?.close());

test('public site: reads public views only, never private columns', async () => {
  const rows = await db.anon('select * from public_vendors');
  assert.equal(rows.length, 2);
  assert.ok(!('email' in rows[0]) && !('owner_id' in rows[0]));
  await assert.rejects(db.anon('select * from vendors'), /permission denied/);
  await assert.rejects(db.anon('select * from leads'), /permission denied/);
  await assert.rejects(db.anon('select * from notifications'), /permission denied/);
  await assert.rejects(db.anon('insert into events (kind) values ($1)', ['view']), /permission denied/);
  await assert.rejects(db.anon(`update vendors set plan = 'featured'`), /permission denied/);
  assert.ok((await db.anon('select * from page_counts')).length >= 1);
});

test('hidden vendors disappear from the public site', async () => {
  const hidden = await makeVendor(db, { name: 'Gone', status: 'hidden' });
  const rows = await db.anon('select id from public_vendors where id = $1', [hidden.id]);
  assert.equal(rows.length, 0);
});

test('vendors see only leads routed to their own listing', async () => {
  const aLeads = await db.user(alice, 'select * from leads');
  assert.equal(aLeads.length, 1);
  assert.equal(aLeads[0].id, leadId);
  assert.equal((await db.user(bob, 'select * from leads')).length, 0);
  assert.equal((await db.user(bob, 'select * from lead_recipients')).length, 0);
  assert.equal((await db.user(admin, 'select * from leads')).length, 1);
});

test('vendors edit their own content but not plan, status or other listings', async () => {
  await db.user(alice, `update vendors set description = 'Forty acres of oaks' where id = $1`, [va.id]);
  assert.equal((await db.one('select description from vendors where id = $1', [va.id])).description, 'Forty acres of oaks');
  await assert.rejects(db.user(alice, `update vendors set plan = 'featured' where id = $1`, [va.id]), /permission denied/);
  await assert.rejects(db.user(alice, `update vendors set status = 'hidden' where id = $1`, [va.id]), /permission denied/);
  await assert.rejects(db.user(alice, `update vendors set owner_id = $2 where id = $1`, [va.id, bob]), /permission denied/);
  await db.user(alice, `update vendors set description = 'hijack' where id = $1`, [vb.id]);  // silently 0 rows
  assert.notEqual((await db.one('select description from vendors where id = $1', [vb.id])).description, 'hijack');
  await assert.rejects(db.user(alice, `insert into packages (vendor_id, name) values ($1, 'x')`, [vb.id]), /row-level security/);
  await db.user(alice, `insert into packages (vendor_id, name, price) values ($1, 'Weekday', 6500)`, [va.id]);
  await assert.rejects(db.user(alice, `update profiles set role = 'admin' where id = $1`, [alice]), /permission denied/);
});

test('vendor reply: updates status, emails the couple, tracks reply time; others are blocked', async () => {
  await assert.rejects(db.user(bob, 'select vendor_reply($1, $2, $3)', [leadId, va.id, 'hi']), /forbidden/);
  await db.sql(`update lead_recipients set sent_at = now() - interval '90 minutes' where lead_id = $1`, [leadId]);
  const [row] = await db.user(alice, 'select (vendor_reply($1, $2, $3)).*', [leadId, va.id, 'Your date is open!']);
  assert.equal(row.status, 'replied');
  assert.ok(row.replied_at && row.opened_at);
  const n = await db.one(`select * from notifications where kind = 'reply_to_couple' and payload->>'lead_id' = $1`, [leadId]);
  assert.equal(n.payload.reply, 'Your date is open!');
  assert.equal(n.payload.reply_to, 'alice@cedarhollow.example');
  assert.equal((await db.one('select avg_reply_minutes from vendors where id = $1', [va.id])).avg_reply_minutes, 90);

  const [booked] = await db.user(alice, 'select (vendor_reply($1, $2, null, $3)).*', [leadId, va.id, 'booked']);
  assert.equal(booked.status, 'booked');
  await assert.rejects(db.user(alice, 'select vendor_reply($1, $2, null, $3)', [leadId, va.id, 'married']), /invalid_status/);
});

test('claims: domain check, admin approval transfers ownership, already-claimed is blocked', async () => {
  const listing = await makeVendor(db, { name: 'Sugar Bloom', website: 'https://sugarbloom.example', email: null });
  const owner = await makeUser(db, 'owner@sugarbloom.example');
  const rival = await makeUser(db, 'rival@gmail.com');
  const a = (await db.user(owner, 'select request_claim($1, $2) as r', [listing.id, '512-423-0101']))[0].r;
  const b = (await db.user(rival, 'select request_claim($1) as r', [listing.id]))[0].r;
  assert.equal(a.check, 'domain_match');
  assert.equal(b.check, 'free_email');
  await assert.rejects(db.anon('select request_claim($1)', [listing.id]), /permission denied/);
  assert.equal((await db.user(rival, 'select * from claims')).length, 1, 'users see only their own claims');

  await assert.rejects(db.user(rival, 'select admin_decide_claim($1, true)', [a.claim_id]), /forbidden/);
  await db.user(admin, 'select admin_decide_claim($1, true)', [a.claim_id]);
  const v = await db.one('select owner_id, status, email from vendors where id = $1', [listing.id]);
  assert.equal(v.owner_id, owner);
  assert.equal(v.status, 'claimed');
  assert.equal(v.email, 'owner@sugarbloom.example', 'claim email becomes the lead email when none was known');
  assert.equal((await db.one('select status from claims where id = $1', [b.claim_id])).status, 'rejected');
  await assert.rejects(db.user(rival, 'select request_claim($1)', [listing.id]), /already_claimed/);
});

test('city pages: free plan = primary city only, featured = up to 5', async () => {
  const dsp = await cityId(db, 'Dripping Springs');
  const ids = await db.sql(`select id from cities where name in ('Wimberley','San Marcos','Round Rock','San Antonio','Dallas') order by name`);
  await assert.rejects(db.user(alice, 'insert into vendor_cities values ($1, $2)', [va.id, dsp]), /city_limit_reached/);
  await db.user(admin, `select admin_set_vendor($1, null, 'featured', '2026-12-01')`, [va.id]);
  await db.user(alice, 'insert into vendor_cities values ($1, $2)', [va.id, dsp]);
  for (const c of ids.slice(0, 3)) await db.user(alice, 'insert into vendor_cities values ($1, $2)', [va.id, c.id]);
  await assert.rejects(db.user(alice, 'insert into vendor_cities values ($1, $2)', [va.id, ids[3].id]), /city_limit_reached/);
  const pc = await db.anon('select vendor_count from page_counts where city_id = $1 and category_id = $2', [dsp, venues]);
  assert.equal(pc[0].vendor_count, 1, 'service-area cities count toward that city page');
});

test('reviews: pending until approved, then rating recalculated', async () => {
  const body = 'Absolutely wonderful day, the team was amazing from start to finish.';
  const r1 = (await db.anon('select submit_review($1, $2, $3, $4, $5, $6) as id', [vb.id, 'Maya', 'm@x.com', '2026-04-01', 5, body]))[0].id;
  const r2 = (await db.anon('select submit_review($1, $2, $3, $4, $5, $6) as id', [vb.id, 'Chris', 'c@x.com', null, 4, body]))[0].id;
  assert.equal((await db.anon('select * from public_reviews where vendor_id = $1', [vb.id])).length, 0);
  await assert.rejects(db.anon('select submit_review($1, $2, $3, $4, $5, $6)', [vb.id, 'Xavier', 'x@x.com', null, 6, body]), /invalid_rating/);
  await assert.rejects(db.anon('select submit_review($1, $2, $3, $4, $5, $6)', [vb.id, 'Xavier', 'not-an-email', null, 5, body]), /invalid_email/);
  await assert.rejects(db.anon('select submit_review($1, $2, $3, $4, $5, $6)', [vb.id, 'Maya', 'M@x.com ', null, 5, body]), /already_reviewed/);
  await db.user(admin, 'select admin_moderate_review($1, true)', [r1]);
  await db.user(admin, 'select admin_moderate_review($1, true)', [r2]);
  assert.equal((await db.anon('select * from public_reviews where vendor_id = $1', [vb.id])).length, 2);
  const v = await db.one('select rating, review_count from vendors where id = $1', [vb.id]);
  assert.equal(Number(v.rating), 4.5);
  assert.equal(v.review_count, 2);
  await assert.rejects(db.user(bob, 'select admin_moderate_review($1, false)', [r1]), /forbidden/);
});

test('reviews: one email can send at most 3 a day', async () => {
  const body = 'Lovely people and a beautiful setting, would book again for sure.';
  // Three reviews already sent today (written directly; only one test vendor is public here).
  for (let i = 0; i < 3; i++) {
    await db.one("insert into reviews (vendor_id, author_name, author_email, rating, body, status) values ($1, 'Sam', 'sam@x.com', 5, $2, 'rejected') returning id", [vb.id, body]);
  }
  await assert.rejects(db.anon('select submit_review($1, $2, $3, $4, $5, $6)', [vb.id, 'Sam', 'sam@x.com', null, 5, body]), /rate_limited/);
  await db.one("delete from reviews where author_email = 'sam@x.com' returning 1");
});

test('categories: admins can add and edit them, vendors and the public cannot', async () => {
  await db.user(admin, `insert into categories (slug, name, singular, sort, budget_share) values ('mehndi-artists', 'Mehndi artists', 'Mehndi artist', 160, 0.02)`);
  await db.user(admin, `update categories set name = 'Henna & mehndi artists' where slug = 'mehndi-artists'`);
  const pub = await db.anon(`select name from categories where slug = 'mehndi-artists'`);
  assert.equal(pub[0].name, 'Henna & mehndi artists', 'new category is visible to the public site');
  await assert.rejects(db.user(alice, `insert into categories (slug, name, singular) values ('x', 'X', 'X')`), /row-level security/);
  await assert.rejects(db.anon(`insert into categories (slug, name, singular) values ('y', 'Y', 'Y')`), /row-level security|permission denied/);
});

test('click tracking and stats: vendor sees own numbers, admin sees totals', async () => {
  for (const k of ['view', 'view', 'click_phone', 'click_website', 'click_directions', 'impression', 'shortlist']) {
    await db.anon('select track_event($1, $2, $3)', [va.id, k, '/vendor/cedar-hollow']);
  }
  await db.anon('select track_impressions($1::uuid[], $2)', [[va.id, vb.id], '/us/texas/austin/wedding-venues']);
  await assert.rejects(db.anon('select track_event($1, $2)', [va.id, 'hack']), /invalid_kind/);

  const s = (await db.user(alice, 'select vendor_stats($1, 30) as s', [va.id]))[0].s;
  assert.equal(s.views, 2);
  assert.equal(s.clicks, 3);
  assert.equal(s.clicks_phone, 1);
  assert.equal(s.impressions, 2);
  assert.equal(s.leads, 1);
  assert.equal(s.rank_of, 3, 'Cedar Hollow, Bob Barn and Sugar Bloom; the hidden one is excluded');
  assert.equal(s.rank, 1, 'featured listing ranks first in its city');
  await assert.rejects(db.user(bob, 'select vendor_stats($1, 30)', [va.id]), /forbidden/);

  const a = (await db.user(admin, 'select admin_stats(14) as s'))[0].s;
  assert.equal(a.clicks, 3);
  assert.equal(a.leads, 1);
  assert.equal(a.paid_vendors, 1);
  assert.equal(a.series.length, 15);
  assert.ok('pending_reviews' in a.attention && 'thin_pages' in a.attention);
  await assert.rejects(db.user(alice, 'select admin_stats(14)'), /forbidden/);
});

test('vendor analytics: only the owner of a claimed listing (or an admin) can read it; views are traced to how couples found them', async () => {
  const hit = (p) => db.anon('select track_hit($1::jsonb)', [JSON.stringify(p)]);
  // Visit 1: Google -> city page -> Alice's profile. Visit 2: lands on her profile from Instagram.
  await hit({ kind: 'page_view', path: '/us/texas/austin/wedding-venues/', vid: 'couple0001', sid: 'visit00001', ref: 'www.google.com', dev: 'mobile' });
  await db.one(`select pg_sleep(0.01)`);
  await hit({ kind: 'view', vendor: va.id, path: '/vendor/cedar-hollow/', vid: 'couple0001', sid: 'visit00001', dev: 'mobile' });
  await hit({ kind: 'view', vendor: va.id, path: '/vendor/cedar-hollow/', vid: 'couple0002', sid: 'visit00002', ref: 'l.instagram.com', dev: 'desktop' });
  await hit({ kind: 'click_phone', vendor: va.id, path: '/vendor/cedar-hollow/', vid: 'couple0002', sid: 'visit00002' });
  const r = (await db.user(alice, 'select vendor_analytics($1, 30) as r', [va.id]))[0].r;
  assert.ok(r.kpi.views >= 2);
  assert.ok(r.kpi.visitors >= 2);
  assert.ok(r.kpi.clicks_phone >= 1);
  const found = Object.fromEntries(r.found_by.map((f) => [f.how, f.views]));
  assert.equal(found['Celebrateio city & category pages'], 1);
  assert.equal(found['Social'], 1);
  assert.equal(r.series.length, 30);
  assert.ok(r.peers.rank >= 1);
  await assert.rejects(db.user(bob, 'select vendor_analytics($1, 30)', [va.id]), /forbidden/, 'another vendor');
  await assert.rejects(db.anon('select vendor_analytics($1, 30)', [va.id]), /permission denied/);
  assert.ok((await db.user(admin, 'select vendor_analytics($1, 30) as r', [va.id]))[0].r.kpi);
  // An owner whose listing is not (or no longer) claimed sees nothing.
  await db.one(`update vendors set status = 'unclaimed' where id = $1 returning id`, [va.id]);
  await assert.rejects(db.user(alice, 'select vendor_analytics($1, 30)', [va.id]), /forbidden/);
  await db.one(`update vendors set status = 'claimed' where id = $1 returning id`, [va.id]);
});
