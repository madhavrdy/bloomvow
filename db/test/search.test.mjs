import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor } from './helpers.mjs';

let db;
before(async () => { db = await freshDb('bv_test_search'); });
after(() => db?.close());
const find = async (q, n = 8) => (await db.anon('select search_vendor_names($1, $2) as r', [q, n]))[0].r;

test('vendor name search: prefix matches first, case-insensitive, safe with wildcards, hides hidden vendors', async () => {
  await makeVendor(db, { name: 'Rosewood Barn', category: 'wedding-venues' });
  await makeVendor(db, { name: 'The Rose Room', category: 'wedding-venues' });
  await makeVendor(db, { name: 'Wild Rose Florals', category: 'florists', city: 'Dallas' });
  await makeVendor(db, { name: 'Rose Secret', category: 'florists', status: 'hidden' });
  await makeVendor(db, { name: '100% Fun DJs', category: 'djs-bands' });

  const r = await find('ROSE');
  assert.deepEqual(r.map((x) => x.name).slice(0, 1), ['Rosewood Barn'], 'starts-with ranks first');
  assert.deepEqual(r.map((x) => x.name).sort(), ['Rosewood Barn', 'The Rose Room', 'Wild Rose Florals']);
  assert.deepEqual(Object.keys(r[0]).sort(), ['cat', 'city', 'name', 'slug', 'st'], 'only public fields');
  assert.equal(r.find((x) => x.name === 'Wild Rose Florals').city, 'Dallas');
  assert.deepEqual(await find('r'), [], 'too short');
  assert.deepEqual(await find('%'), [], 'a lone wildcard matches nothing');
  assert.deepEqual((await find('100%')).map((x) => x.name), ['100% Fun DJs']);
  assert.equal((await find('rose', 2)).length, 2);
});
