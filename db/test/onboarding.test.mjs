import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor, makeUser, cityId, catId } from './helpers.mjs';

let db, admin, owner, other, austin, florists, listing;

before(async () => {
  db = await freshDb('bv_test_onboarding');
  admin = await makeUser(db, 'admin@bloomvow.test', 'admin');
  owner = await makeUser(db, 'owner@fernfig.example');
  other = await makeUser(db, 'other@x.example');
  austin = await cityId(db, 'Austin');
  florists = await catId(db, 'florists');
  listing = await makeVendor(db, { name: 'Owned Venue', owner_id: owner, status: 'claimed' });
});
after(() => db?.close());

test('a vendor can add a new business: hidden until an admin approves the claim', async () => {
  const r = (await db.user(owner, 'select create_listing($1, $2, $3, $4, $5) as r', ['Fern & Fig Florals', florists, austin, '512-423-0101', 'https://fernfig.example']))[0].r;
  assert.equal(r.slug, 'fern-fig-florals-austin');
  const v = await db.one('select status, email, source, owner_id from vendors where id = $1', [r.vendor_id]);
  assert.deepEqual({ ...v }, { status: 'hidden', email: 'owner@fernfig.example', source: 'self_signup', owner_id: null });
  assert.equal((await db.anon('select 1 from public_vendors where id = $1', [r.vendor_id])).length, 0, 'not public yet');

  const mine = await db.user(owner, 'select * from my_claims');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].claim_status, 'pending');
  assert.equal((await db.user(other, 'select * from my_claims')).length, 0);

  await db.user(admin, 'select admin_decide_claim($1, true)', [r.claim_id]);
  const live = await db.one('select status, owner_id from vendors where id = $1', [r.vendor_id]);
  assert.equal(live.status, 'claimed');
  assert.equal(live.owner_id, owner);
  assert.equal((await db.anon('select 1 from public_vendors where id = $1', [r.vendor_id])).length, 1, 'live after approval');
});

test('add business: validation, login required, max 3 pending', async () => {
  await assert.rejects(db.user(other, 'select create_listing($1, $2, $3)', ['', florists, austin]), /name_required/);
  await assert.rejects(db.user(other, 'select create_listing($1, $2, $3)', ['Okay Name', 9999, austin]), /invalid_category/);
  await assert.rejects(db.user(other, 'select create_listing($1, $2, $3)', ['Okay Name', florists, 999999]), /invalid_city/);
  await assert.rejects(db.anon('select create_listing($1, $2, $3)', ['Okay Name', florists, austin]), /permission denied/);
  for (let i = 1; i <= 3; i++) await db.user(other, 'select create_listing($1, $2, $3)', [`Spam Co ${i}`, florists, austin]);
  await assert.rejects(db.user(other, 'select create_listing($1, $2, $3)', ['Spam Co 4', florists, austin]), /too_many_pending/);
});

test('photos: owners add up to 30; storage uploads only into their own folder', async () => {
  for (let i = 0; i < 30; i++) await db.user(owner, 'insert into photos (vendor_id, url, sort) values ($1, $2, $3)', [listing.id, `https://cdn.example/${i}.jpg`, i]);
  await assert.rejects(db.user(owner, 'insert into photos (vendor_id, url) values ($1, $2)', [listing.id, 'https://cdn.example/31.jpg']), /photo_limit_reached/);

  await db.user(owner, `insert into storage.objects (bucket_id, name) values ('vendor-photos', $1)`, [`${listing.id}/a.jpg`]);
  await assert.rejects(db.user(other, `insert into storage.objects (bucket_id, name) values ('vendor-photos', $1)`, [`${listing.id}/b.jpg`]), /row-level security/);
  await assert.rejects(db.user(owner, `insert into storage.objects (bucket_id, name) values ('vendor-photos', $1)`, ['not-a-uuid/c.jpg']), /row-level security/);
  await db.user(admin, `insert into storage.objects (bucket_id, name) values ('vendor-photos', $1)`, [`${listing.id}/admin.jpg`]);
  const del = await db.user(other, `delete from storage.objects where name = $1 returning id`, [`${listing.id}/a.jpg`]);
  assert.equal(del.length, 0, 'others cannot delete');
  assert.equal((await db.anon(`select name from storage.objects where bucket_id = 'vendor-photos'`)).length, 2, 'public can view');
});
