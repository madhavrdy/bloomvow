import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, cityId, catId, makeUser } from './helpers.mjs';

let db;
before(async () => { db = await freshDb('bv_test_hygiene'); });
after(() => db?.close());

const reason = async (name, cat) => (await db.one('select vendor_misfit_reason($1, $2) r', [name, cat])).r;

test('misfit rules: clear non-wedding businesses are flagged, real wedding vendors are not', async () => {
  for (const [name, cat] of [
    ['Lauren Permanent Makeup', 'hair-makeup'], ['Rose Nails And Lashes', 'hair-makeup'], ['Brow Definition', 'hair-makeup'],
    ['Austin Real Estate Photography', 'photographers'], ['Corporate Headshots Atlanta', 'photographers'], ['Strato Drone Solutions', 'photographers'],
    ['Landmark Auditorium', 'wedding-venues'], ['NextSpace Coworking', 'wedding-venues'],
    ['Buzz City Bounce', 'rentals'], ['Insomnia Cookies', 'wedding-cakes'], ['Fancy Funnel Cake', 'wedding-cakes'],
    ['Town Taxi', 'transportation'], ['Opus Music Academy', 'djs-bands'], ['Colorado Global Film Festival', 'videographers'],
    ["Oskar's Pizza", 'caterers'], ['Garden Gate Nursery', 'florists'], ['City College of San Francisco', 'photographers'],
  ]) assert.ok(await reason(name, cat), `${name} should be flagged`);
  for (const [name, cat] of [
    ['Slate Hair and Makeup', 'hair-makeup'], ['Glam by Jess - Makeup & Lashes', 'hair-makeup'], ['Bridal Brows & Lashes', 'hair-makeup'],
    ['Barrett Photography', 'photographers'], ['Aerial Weddings Co', 'photographers'],
    ['The River Place', 'wedding-venues'], ['University Club of Pasadena', 'wedding-venues'], ['Portland Spirit Office & Landing', 'wedding-venues'],
    ['Amazing Jumps Tents & Events', 'rentals'], ['Chris\' Cakes And Donuts', 'wedding-cakes'], ['Smallcakes Cupcakery', 'wedding-cakes'],
    ['Wellesley Taxi and Limo', 'transportation'], ['San Diego DJ and Karaoke', 'djs-bands'], ['Hitched Productions', 'videographers'],
    ['Urbn Pizza Truck Catering', 'caterers'], ['West End Florist & Garden Center', 'florists'], ['University Village Florist', 'florists'],
  ]) assert.equal(await reason(name, cat), null, `${name} should stay`);
});

test('imports hide misfits automatically; claimed vendors are never auto-hidden; un-hiding clears the reason', async () => {
  const city = await cityId(db, 'Austin'); const hm = await catId(db, 'hair-makeup');
  const ins = (name, extra = {}) => db.one(
    `insert into vendors (slug, name, category_id, city_id, source, status, owner_id) values ($1, $2, $3, $4, $5, coalesce($6, 'unclaimed'), $7) returning id, status, hidden_reason`,
    [name.toLowerCase().replace(/\W+/g, '-'), name, hm, city, extra.source ?? 'overture', extra.status ?? null, extra.owner ?? null]);
  const nails = await ins('Glamour Nails Austin');
  assert.equal(nails.status, 'hidden');
  assert.match(nails.hidden_reason, /Beauty service/);
  assert.equal((await ins('Slate Hair and Makeup Austin')).status, 'unclaimed');
  assert.equal((await ins('Manual Nails Entry', { source: 'csv' })).status, 'unclaimed', 'admin CSV imports are left as given');

  const back = await db.one(`update vendors set status = 'unclaimed' where id = $1 returning status, hidden_reason`, [nails.id]);
  assert.deepEqual(back, { status: 'unclaimed', hidden_reason: null }, 'an admin can bring it back');
  const manual = await db.one(`update vendors set status = 'hidden' where id = $1 returning hidden_reason`, [nails.id]);
  assert.equal(manual.hidden_reason, 'Hidden by an admin');

  const owner = await makeUser(db, 'owner@nails.test');
  const claimed = await ins('Owner Nails Studio', { status: 'claimed', owner });
  assert.equal(claimed.status, 'claimed');
  const pub = await db.anon(`select count(*)::int n from public_vendors where id = $1`, [nails.id]);
  assert.equal(pub[0].n, 0, 'hidden listings are not public');
});
