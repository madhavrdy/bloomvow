import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser } from './helpers.mjs';

let db, admin;
const imp = (rows, uid = admin) => db.user(uid, 'select admin_import_vendors($1::jsonb, $2) as r', [JSON.stringify(rows), 'test']).then((r) => r[0].r);

before(async () => {
  db = await freshDb('bv_test_import');
  admin = await makeUser(db, 'admin@bloomvow.test', 'admin');
});
after(() => db?.close());

test('imports rows, resolves category/state by name or code, creates missing cities', async () => {
  const r = await imp([
    { name: 'Golden Hour Catering', category: 'caterers', city: 'Austin', state: 'TX', phone: '(512) 555-0100', website: 'https://goldenhour.example/menu', price_from: '$4,500', capacity: '300 guests' },
    { name: 'Lumen Studio', category: 'Wedding photographer', city: 'nashville', state: 'Tennessee', email: 'Hello@Lumen.example' },
    { name: 'Lake Travis Lodge', category: 'Wedding venues', city: 'Lakeway', state: 'tx', lat: '30.36', lng: '-97.98' },
  ]);
  assert.deepEqual({ ...r, needs_review: r.needs_review.length }, { rows: 3, inserted: 3, merged: 0, needs_review: 0 });
  const g = await db.one(`select * from vendors where name = 'Golden Hour Catering'`);
  assert.equal(g.price_from, 4500);
  assert.equal(g.capacity_max, 300);
  assert.equal(g.slug, 'golden-hour-catering-austin');
  assert.equal(g.status, 'unclaimed');
  assert.equal((await db.one(`select email from vendors where name = 'Lumen Studio'`)).email, 'hello@lumen.example');
  const city = await db.one(`select * from cities where slug = 'lakeway'`);
  assert.equal(city.name, 'Lakeway');
  assert.equal(city.lat, 30.36);
});

test('duplicates merge by phone, website domain, or same name in city; nothing is overwritten', async () => {
  const r = await imp([
    { name: 'Golden Hour Catering Co', category: 'caterers', city: 'Austin', state: 'TX', phone: '+1 512-555-0100', email: 'events@goldenhour.example', price_from: '9999' },
    { name: 'Golden Hour', category: 'caterers', city: 'Austin', state: 'TX', website: 'http://www.goldenhour.example' },
    { name: 'Lumen Studio', category: 'photographers', city: 'Nashville', state: 'TN', phone: '615 555 0199' },
    { name: 'Golden Hour Catering', category: 'caterers', city: 'Dallas', state: 'TX', website: 'https://other.example' },
  ]);
  assert.equal(r.merged, 3);
  assert.equal(r.inserted, 1, 'same name in a different city is a separate vendor');
  const g = await db.one(`select * from vendors where slug = 'golden-hour-catering-austin'`);
  assert.equal(g.email, 'events@goldenhour.example', 'empty field filled in');
  assert.equal(g.price_from, 4500, 'existing value kept');
  assert.equal((await db.one(`select phone from vendors where name = 'Lumen Studio'`)).phone, '615 555 0199');
});

test('bad rows are reported for review, good rows still import; slugs stay unique', async () => {
  const r = await imp([
    { name: '', category: 'caterers', city: 'Austin', state: 'TX' },
    { name: 'Mystery Co', category: 'balloon artists', city: 'Austin', state: 'TX' },
    { name: 'Nowhere Inc', category: 'florists', city: 'Austin', state: 'Narnia' },
    { name: 'No City Florals', category: 'florists', state: 'TX' },
    { name: 'Petal & Stem', category: 'florists', city: 'Austin', state: 'TX', phone: '512-555-0111' },
    { name: 'Petal & Stem', category: 'florists', city: 'Austin', state: 'TX', phone: '512-555-0112' },
  ]);
  assert.equal(r.inserted, 1);
  assert.equal(r.merged, 1, 'same name and city counts as the same florist');
  assert.deepEqual(r.needs_review.map((x) => x.row), [1, 2, 3, 4]);
  assert.match(r.needs_review[1].reason, /unknown category/);
  assert.match(r.needs_review[2].reason, /unknown state/);

  await imp([{ name: 'Petal & Stem', category: 'wedding-cakes', city: 'Austin', state: 'TX' }]);
  const slugs = (await db.sql(`select slug from vendors where name = 'Petal & Stem' order by slug`)).map((x) => x.slug);
  assert.deepEqual(slugs, ['petal-stem-austin', 'petal-stem-austin-2']);
});

test('only admins can import', async () => {
  const vendor = await makeUser(db, 'vendor@x.test');
  await assert.rejects(imp([{ name: 'X', category: 'florists', city: 'Austin', state: 'TX' }], vendor), /forbidden/);
  await assert.rejects(db.anon(`select admin_import_vendors('[]'::jsonb)`), /permission denied/);
});
