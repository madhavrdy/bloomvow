import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor, makeUser } from './helpers.mjs';

let db, admin, owner, other, mine, theirs;
before(async () => {
  db = await freshDb('bv_test_details');
  admin = await makeUser(db, 'admin@site.test', 'admin');
  owner = await makeUser(db, 'owner@venue.test');
  other = await makeUser(db, 'other@venue.test');
  mine = (await makeVendor(db, { name: 'Owned Hall', owner_id: owner, status: 'claimed' })).id;
  theirs = (await makeVendor(db, { name: 'Unclaimed Barn' })).id;
});
after(() => db?.close());

const upd = (uid, id, d) => db.user(uid, 'update vendors set details = $2::jsonb where id = $1 returning details', [id, JSON.stringify(d)]);
const good = { amenities: ['Dance floor', 'Wheelchair accessible'], catering_policy: 'In-house catering only', capacity_seated: 180, languages: ['English', 'Spanish'] };

test('vendor details: owners edit their own, admins edit any, others cannot; public view exposes them', async () => {
  assert.deepEqual((await upd(owner, mine, good))[0].details, good);
  assert.equal((await upd(owner, theirs, good)).length, 0, 'not their listing');
  assert.equal((await upd(other, mine, {})).length, 0);
  assert.deepEqual((await upd(admin, theirs, { services: ['Bar & drinks'] }))[0].details, { services: ['Bar & drinks'] });
  const pub = await db.anon('select details from public_vendors where id = $1', [mine]);
  assert.deepEqual(pub[0].details, good);
  assert.equal((await db.one('select details from vendors where id = (select id from vendors where name = $1)', ['Unclaimed Barn'])).details.services[0], 'Bar & drinks');
});

test('vendor details: shape and size are checked', async () => {
  for (const bad of [
    [1, 2], 'text', { 'Bad Key': ['x'] }, { amenities: [1] }, { amenities: [''] }, { amenities: ['x'.repeat(81)] },
    { amenities: Array.from({ length: 61 }, (_, i) => `a${i}`) }, { capacity: -5 }, { capacity: 0 }, { flag: true }, { nested: { a: 1 } },
    Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`k${String.fromCharCode(97 + (i % 26))}${i}`.replace(/\d/g, (n) => 'abcdefghij'[n]), 'x'])),
  ]) await assert.rejects(upd(admin, theirs, bad), /vendors_details_check/, JSON.stringify(bad).slice(0, 80));
});

test('self-signup listings start hidden without an admin-hide label', async () => {
  const id = (await makeVendor(db, { name: 'New Signup', status: 'hidden' })).id;
  assert.equal((await db.one('select hidden_reason from vendors where id = $1', [id])).hidden_reason, null);
  await db.sql(`update vendors set status = 'unclaimed' where id = $1`, [id]);
  await db.sql(`update vendors set status = 'hidden' where id = $1`, [id]);
  assert.equal((await db.one('select hidden_reason from vendors where id = $1', [id])).hidden_reason, 'Hidden by an admin');
});
