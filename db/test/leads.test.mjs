import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor, makeUser, cityId, catId, lead } from './helpers.mjs';

let db, austin, dallas, venues, photogs;
const submit = (p) => db.anon('select submit_lead($1::jsonb) as r', [JSON.stringify(p)]).then((r) => r[0].r);
const recipients = (leadId) => db.sql(
  `select v.name from lead_recipients lr join vendors v on v.id = lr.vendor_id where lr.lead_id = $1 order by lr.sent_at, v.name`, [leadId]
).then((r) => r.map((x) => x.name));

before(async () => {
  db = await freshDb('bv_test_leads');
  austin = await cityId(db, 'Austin');
  dallas = await cityId(db, 'Dallas');
  venues = await catId(db, 'wedding-venues');
  photogs = await catId(db, 'photographers');
});
after(() => db?.close());

test('rejects invalid submissions with clear error codes', async () => {
  const bad = [
    [{ source: 'nope' }, /invalid_source/],
    [lead({ couple_name: '  ', city_id: austin, category_ids: [venues] }), /name_required/],
    [lead({ email: 'not-an-email', city_id: austin, category_ids: [venues] }), /invalid_email/],
    [lead({ city_id: 999999, category_ids: [venues] }), /invalid_city/],
    [lead({ city_id: austin, category_ids: [] }), /invalid_categories/],
    [lead({ city_id: austin, category_ids: [9999] }), /invalid_categories/],
    [lead({ city_id: austin, category_ids: [venues], guests: 0 }), /invalid_guests/],
    [lead({ city_id: austin, category_ids: [venues], budget_band: 9 }), /invalid_budget/],
    [lead({ city_id: austin, category_ids: [venues], wedding_date: 'soon' }), /invalid_field/],
    [lead({ source: 'profile', city_id: austin, vendor_id: '00000000-0000-0000-0000-000000000000' }), /invalid_vendor/],
  ];
  for (const [payload, err] of bad) await assert.rejects(submit(payload), err);
});

test('matched request: right category, city, capacity and budget; featured first; 3 per category', async () => {
  await makeVendor(db, { name: 'Small Barn', capacity_max: 80, price_from: 9000 });            // too small
  await makeVendor(db, { name: 'Pricey Estate', capacity_max: 300, price_from: 40000 });       // over budget share
  await makeVendor(db, { name: 'No Email Hall', capacity_max: 300, email: null });             // cannot receive
  await makeVendor(db, { name: 'Hidden Ranch', capacity_max: 300, status: 'hidden' });
  await makeVendor(db, { name: 'Dallas Loft', city: 'Dallas', capacity_max: 300 });            // 290 km away
  await makeVendor(db, { name: 'Oak Lawn', capacity_max: 250, price_from: 9000, rating: 4.6 });
  await makeVendor(db, { name: 'River Chapel', capacity_max: 200, rating: 4.9, status: 'claimed' });
  await makeVendor(db, { name: 'Hill Featured', capacity_max: 200, plan: 'featured', rating: 4.1 });
  await makeVendor(db, { name: 'Springs Ranch', city: 'Dripping Springs', capacity_max: 250, rating: 5.0 });
  await makeVendor(db, { name: 'Lens Austin', category: 'photographers', rating: 4.8 });

  const r = await submit(lead({ city_id: austin, category_ids: [venues, photogs], guests: 150, budget_band: 2 }));
  assert.equal(r.matched, 4);
  const names = await recipients(r.lead_id);
  assert.deepEqual(names.slice().sort(), ['Hill Featured', 'Lens Austin', 'Oak Lawn', 'River Chapel'].sort());

  const order = await db.sql('select vendor_id from match_vendors($1, $2, 150, 2, 10)', [austin, venues]);
  const ordered = await db.sql('select name from vendors where id = any($1::uuid[])', [order.map((o) => o.vendor_id)]);
  assert.equal(order.length, 4, 'Springs Ranch (nearby) is the 4th venue match');
  const first = await db.one('select name from vendors where id = $1', [order[0].vendor_id]);
  const last = await db.one('select name from vendors where id = $1', [order[3].vendor_id]);
  assert.equal(first.name, 'Hill Featured', 'featured plan ranks first');
  assert.equal(last.name, 'Springs Ranch', 'same-city vendors rank before nearby towns');
  assert.ok(ordered.length === 4);
});

test('nearby towns are used, far cities are not', async () => {
  const ds = await cityId(db, 'Dripping Springs');
  const r = await submit(lead({ city_id: ds, category_ids: [venues], guests: 100, budget_band: 4 }));
  const names = await recipients(r.lead_id);
  assert.ok(names.includes('Springs Ranch'));
  assert.ok(!names.includes('Dallas Loft'));
  const rd = await submit(lead({ city_id: dallas, category_ids: [venues], guests: 100 }));
  assert.deepEqual(await recipients(rd.lead_id), ['Dallas Loft']);
});

test('profile lead goes to that vendor, plus up to 3 similar when ticked', async () => {
  const target = await db.one(`select id from vendors where name = 'Oak Lawn'`);
  const solo = await submit(lead({ source: 'profile', vendor_id: target.id, city_id: austin }));
  assert.deepEqual(await recipients(solo.lead_id), ['Oak Lawn']);

  const withSimilar = await submit(lead({ source: 'profile', vendor_id: target.id, city_id: austin, also_similar: true, guests: 150, budget_band: 2 }));
  const names = await recipients(withSimilar.lead_id);
  assert.ok(names.includes('Oak Lawn'));
  assert.equal(names.length, 4);
  assert.equal(new Set(names).size, 4, 'no vendor receives the same lead twice');
});

test('bulk request uses the larger limit for one category', async () => {
  for (let i = 0; i < 10; i++) await makeVendor(db, { name: `Lens ${i}`, category: 'photographers' });
  const r = await submit(lead({ source: 'bulk', city_id: austin, category_ids: [photogs] }));
  assert.equal(r.matched, 8);
});

test('every recipient with an email gets a queued notification', async () => {
  const r = await submit(lead({ city_id: austin, category_ids: [photogs] }));
  const q = await db.sql(`select count(*)::int as n from notifications where kind = 'lead_to_vendor' and payload->>'lead_id' = $1`, [r.lead_id]);
  assert.equal(q[0].n, r.matched);
});

test('no matching vendors marks the lead unmatched (admin can re-route later)', async () => {
  const r = await submit(lead({ city_id: await cityId(db, 'Seattle'), category_ids: [venues] }));
  assert.equal(r.matched, 0);
  assert.equal((await db.one('select status from leads where id = $1', [r.lead_id])).status, 'unmatched');
});

test('honeypot submissions are accepted silently but routed nowhere', async () => {
  const r = await submit(lead({ city_id: austin, category_ids: [venues], website: 'http://spam.example' }));
  assert.equal(r.matched, 0);
  assert.equal((await db.one('select status from leads where id = $1', [r.lead_id])).status, 'spam');
});

test('rate limit: 5 requests per email per hour', async () => {
  const email = 'busy@example.com';
  for (let i = 0; i < 5; i++) await submit(lead({ email, city_id: austin, category_ids: [photogs] }));
  await assert.rejects(submit(lead({ email: 'BUSY@example.com', city_id: austin, category_ids: [photogs] })), /rate_limited/);
});

test('admin re-route adds new vendors only; reminders fire once after 24h', async () => {
  const admin = await makeUser(db, 'admin@bloomvow.test', 'admin');
  const r = await submit(lead({ city_id: austin, category_ids: [photogs] }));
  const before = await recipients(r.lead_id);
  const added = (await db.user(admin, 'select admin_reroute_lead($1, 3) as n', [r.lead_id]))[0].n;
  assert.equal(added, 3);
  const after = await recipients(r.lead_id);
  assert.equal(after.length, before.length + 3);
  assert.equal(new Set(after).size, after.length);

  await db.sql(`update lead_recipients set sent_at = now() - interval '25 hours' where lead_id = $1`, [r.lead_id]);
  const first = (await db.as('service_role', null, 'select queue_lead_reminders() as n'))[0].n;
  const second = (await db.as('service_role', null, 'select queue_lead_reminders() as n'))[0].n;
  assert.equal(first, after.length);
  assert.equal(second, 0);

  const vendor = await makeUser(db, 'v@x.test');
  await assert.rejects(db.user(vendor, 'select admin_reroute_lead($1, 3)', [r.lead_id]), /forbidden/);
  await assert.rejects(db.anon('select queue_lead_reminders()'), /permission denied/);
});
