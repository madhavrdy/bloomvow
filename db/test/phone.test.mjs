import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor, makeUser, cityId, catId, lead } from './helpers.mjs';

let db, austin, venues, owner, mine;
const submit = (p) => db.anon('select submit_lead($1::jsonb) as r', [JSON.stringify(p)]).then((r) => r[0].r);
before(async () => {
  db = await freshDb('bv_test_phone');
  austin = await cityId(db, 'Austin');
  venues = await catId(db, 'wedding-venues');
  owner = await makeUser(db, 'owner@hall.test');
  mine = (await makeVendor(db, { name: 'Phone Hall', owner_id: owner, status: 'claimed', phone: 'call 512 four five' })).id;
});
after(() => db?.close());

test('normalize_phone: US/Canada in any layout, international with +, extensions; junk refused', async () => {
  const cases = {
    '(212) 423-0172': '+12124230172', '212.423.0172': '+12124230172', '1-212-423-0172': '+12124230172',
    '+1 212 423 0172': '+12124230172', '212-423-0172 ext. 45': '+12124230172;ext=45',
    '+44 20  7123 4567': '+44 20 7123 4567', '+91 98765 43210': '+91 98765 43210',
    '123-456-7890': null, '555-0100': null, 'abc': null, '2124230172000': null, '0000000000': null,
    '212-555-0123': null, '+44 12': null, '': null,
  };
  for (const [raw, want] of Object.entries(cases)) {
    const r = await db.one('select normalize_phone($1) as p', [raw]);
    assert.equal(r.p, want, raw);
  }
});

test('leads: a phone is required; bad ones are refused, good ones stored tidy', async () => {
  await assert.rejects(submit(lead({ city_id: austin, category_ids: [venues], phone: '12345' })), /invalid_phone/);
  await submit(lead({ city_id: austin, category_ids: [venues], phone: '(512) 423-0172', email: 'p1@x.test' }));
  await assert.rejects(submit(lead({ city_id: austin, category_ids: [venues], phone: '   ', email: 'p2@x.test' })), /phone_required/);
  await assert.rejects(submit(lead({ city_id: austin, category_ids: [venues], phone: null, email: 'p3@x.test' })), /phone_required/);
  const rows = await db.sql(`select email, phone from leads where email in ('p1@x.test','p2@x.test','p3@x.test') order by email`);
  assert.deepEqual(rows.map((r) => r.phone), ['+15124230172'], 'only the request with a phone was saved');
});

test('vendors: imported numbers kept; owners must enter a valid one when they change it', async () => {
  assert.equal((await db.one('select phone from vendors where id = $1', [mine])).phone, 'call 512 four five', 'import kept');
  const upd = (sql, args) => db.user(owner, sql, args);
  await upd('update vendors set name = $2 where id = $1', [mine, 'Phone Hall & Garden']);   // other edits still save
  await upd('update vendors set phone = phone where id = $1', [mine]);                       // re-saving the same number is fine
  await assert.rejects(upd('update vendors set phone = $2 where id = $1', [mine, 'not a number']), /invalid_phone/);
  await upd('update vendors set phone = $2 where id = $1', [mine, '512.423.0172 x9']);
  assert.equal((await db.one('select phone from vendors where id = $1', [mine])).phone, '+15124230172;ext=9');
  await upd('update vendors set phone = $2 where id = $1', [mine, '']);
  assert.equal((await db.one('select phone from vendors where id = $1', [mine])).phone, null);
});

test('new business sign-up refuses a bad phone', async () => {
  const u = await makeUser(db, 'new@biz.test');
  const call = (ph) => db.user(u, 'select create_listing($1, $2, $3, $4) as r', ['Fresh Blooms', venues, austin, ph]);
  await assert.rejects(call('12'), /invalid_phone/);
  await call('(737) 201-0000');
  assert.equal((await db.one(`select phone from vendors where name = 'Fresh Blooms'`)).phone, '+17372010000');
});

test('leads: wedding date must be from today to 5 years ahead', async () => {
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await assert.rejects(submit(lead({ city_id: austin, category_ids: [venues], wedding_date: day(-30) })), /invalid_date/);
  await assert.rejects(submit(lead({ city_id: austin, category_ids: [venues], wedding_date: day(6 * 366) })), /invalid_date/);
  await submit(lead({ city_id: austin, category_ids: [venues], wedding_date: day(200) }));
  await submit(lead({ city_id: austin, category_ids: [venues], wedding_date: null }));
});
