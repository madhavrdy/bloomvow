import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor } from './helpers.mjs';

let db;
before(async () => { db = await freshDb('bv_test_nearby'); });
after(() => db?.close());

test('nearby vendors: same city first, then nearby cities by popularity; far cities excluded; team = top per other category', async () => {
  const mk = (o) => makeVendor(db, { category: 'florists', ...o });
  const me = await mk({ name: 'Me Florals' });
  const quiet = await mk({ name: 'Quiet Austin Florist' });
  const loved = await mk({ name: 'Loved Austin Florist', rating: 4.9, review_count: 40 });
  const rr = await mk({ name: 'Round Rock Blooms', city: 'Round Rock', rating: 5, review_count: 80 });   // ~30 km away
  await mk({ name: 'Dallas Flowers', city: 'Dallas', rating: 5, review_count: 200 });                    // ~300 km: excluded
  // Activity counts toward popularity: the quiet florist gets lots of calls.
  await db.sql(`insert into events (vendor_id, kind) select $1, 'click_phone' from generate_series(1, 60)`, [quiet.id]);
  await mk({ name: 'Top Venue', category: 'wedding-venues', rating: 4.8, review_count: 30 });
  await mk({ name: 'Other Venue', category: 'wedding-venues' });
  await mk({ name: 'Only Photographer', category: 'photographers' });
  await mk({ name: 'Hidden Cake', category: 'wedding-cakes', status: 'hidden' });

  const r = (await db.anon('select nearby_vendors($1, 6) as r', [me.id]))[0].r;
  assert.deepEqual(r.same.map((x) => x.name), ['Loved Austin Florist', 'Quiet Austin Florist', 'Round Rock Blooms'], 'same city by popularity, then nearby');
  assert.equal(r.same[2].city, 'Round Rock');
  assert.ok(r.same[2].km > 0 && r.same[2].km <= 80);
  assert.ok(!r.same.some((x) => x.name === 'Me Florals'), 'not itself');
  assert.deepEqual(r.team.map((x) => x.name).sort(), ['Only Photographer', 'Top Venue']);
  assert.ok(!('email' in r.same[0]) && !('phone' in r.same[0]), 'no private fields');
  assert.ok(Number((await db.anon('select activity from vendor_popularity where vendor_id = $1', [quiet.id]))[0].activity) > 0);
  void loved; void rr;
});
