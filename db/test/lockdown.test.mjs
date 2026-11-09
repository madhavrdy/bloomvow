import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor, makeUser } from './helpers.mjs';

let db, v;
before(async () => { db = await freshDb('bv_test_lockdown'); v = await makeVendor(db, { name: 'Locked Hall' }); });
after(() => db?.close());

test('public views are read-only for visitors and signed-in users', async () => {
  const u = await makeUser(db, 'someone@x.test');
  for (const [who, run] of [['anon', (s, a) => db.anon(s, a)], ['user', (s, a) => db.user(u, s, a)]]) {
    await assert.rejects(run(`update public_vendors set phone = '999' where id = $1`, [v.id]), /permission denied/, `${who} vendor edit`);
    await assert.rejects(run(`delete from public_vendors where id = $1`, [v.id]), /permission denied/, `${who} vendor delete`);
    await assert.rejects(run(`insert into public_reviews (vendor_id, author_name, rating, body) values ($1, 'x', 5, 'fake')`, [v.id]), /permission denied/, `${who} fake review`);
    await assert.rejects(run(`update public_blog_categories set name = 'x'`), /permission denied/, `${who} category edit`);
  }
  assert.equal((await db.one('select phone from vendors where id = $1', [v.id])).phone, v.phone ?? null);
  assert.ok((await db.anon('select id from public_vendors where id = $1', [v.id])).length === 1, 'reading still works');
});

test('visitors cannot write any table directly', async () => {
  await assert.rejects(db.anon(`insert into leads default values`), /permission denied/);
  await assert.rejects(db.anon(`update settings set value = '1' where key = 'nearby_km'`), /permission denied/);
});
