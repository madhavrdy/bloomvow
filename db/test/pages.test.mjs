import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, makeVendor, cityId, catId } from './helpers.mjs';

let db, admin, editor, vendor;
before(async () => {
  db = await freshDb('bv_test_pages');
  admin = await makeUser(db, 'admin@x.test', 'admin');
  editor = await makeUser(db, 'ed@x.test', 'editor');
  vendor = await makeUser(db, 'v@x.test');
});
after(() => db?.close());
const PATH = '/us/texas/austin/wedding-venues/';

test('page content: editors write, everyone reads, FAQs validated, path format enforced', async () => {
  await db.user(editor, `insert into page_content (path, intro, body, faqs, seo_title) values ($1, 'Short intro.', '## Guide', $2, 'Austin venues')`,
    [PATH, JSON.stringify([{ q: 'Do venues include catering?', a: 'Some do.' }])]);
  const [row] = await db.anon('select * from page_content');
  assert.equal(row.intro, 'Short intro.');
  assert.equal(row.updated_by, editor);
  await assert.rejects(db.user(vendor, `update page_content set intro = 'x' where path = $1`, [PATH]).then(async () => {
    if ((await db.anon('select intro from page_content'))[0].intro === 'x') throw new Error('row-level security bypassed');
    throw new Error('row-level security: no rows changed');
  }), /row-level security/);
  await assert.rejects(db.anon(`insert into page_content (path) values ('/x/')`), /permission denied|row-level security/);
  await assert.rejects(db.user(editor, `update page_content set faqs = '[{"q":"Only a question"}]' where path = $1`, [PATH]), /invalid_faqs/);
  await assert.rejects(db.user(editor, `insert into page_content (path) values ('no-slash')`), /check constraint/);
  await assert.rejects(db.user(editor, `update page_content set intro = repeat('x', 700) where path = $1`, [PATH]), /check constraint/);
});

test('page views are tracked per page; traffic list is for editors only', async () => {
  for (let i = 0; i < 3; i++) await db.anon(`select track_event(null, 'page_view', $1)`, [PATH]);
  await db.anon(`select track_event(null, 'page_view', 'javascript:bad')`);
  const t = await db.user(editor, 'select * from admin_page_traffic(30)');
  assert.deepEqual(t.map((r) => ({ path: r.path, views: Number(r.views) })), [{ path: PATH, views: 3 }]);
  await assert.rejects(db.user(vendor, 'select * from admin_page_traffic(30)'), /forbidden/);
  await assert.rejects(db.anon('select * from admin_page_traffic(30)'), /permission denied/);
});

test('search_vendors: whole city incl. service area, filters, styles, sorting, paging', async () => {
  const austin = await cityId(db, 'Austin'); const rr = await cityId(db, 'Round Rock'); const cat = await catId(db, 'wedding-venues');
  const mk = (o) => makeVendor(db, { category: 'wedding-venues', ...o });
  const a = await mk({ name: 'Cedar Barn', price_from: 4000, capacity_max: 150, rating: 4.8, review_count: 10 });
  const b = await mk({ name: 'Lakeside Pier Hall', price_from: 9000, capacity_max: 300, rating: 4.2, review_count: 3 });
  const c = await mk({ name: 'Rock Ranch', city: 'Round Rock', price_from: 2500, capacity_max: 80, plan: 'featured' });  // featured: may list extra cities
  await db.sql(`insert into vendor_cities values ($1, $2)`, [c.id, austin]);
  await mk({ name: 'Hidden One', status: 'hidden' });
  await db.sql(`update vendors set setting = 'Outdoor' where id = $1`, [a.id]);
  const s = async (p) => (await db.anon('select search_vendors($1, $2, $3::jsonb) as r', [austin, cat, JSON.stringify(p)]))[0].r;

  let r = await s({});
  assert.equal(r.total, 3, 'service-area vendor included, hidden excluded');
  assert.deepEqual(r.rows.map((x) => x.name), ['Rock Ranch', 'Cedar Barn', 'Lakeside Pier Hall'], 'featured first, then rating');
  assert.equal((await s({ guests: 200 })).total, 1);
  assert.deepEqual((await s({ prices: [[0, 5000]] })).rows.map((x) => x.name), ['Rock Ranch', 'Cedar Barn']);
  assert.equal((await s({ min_rating: 4.5 })).total, 1);
  assert.deepEqual((await s({ settings: ['Outdoor'] })).rows.map((x) => x.name), ['Cedar Barn']);
  assert.deepEqual((await s({ style: 'barn' })).rows.map((x) => x.name), ['Rock Ranch', 'Cedar Barn']);
  assert.deepEqual((await s({ style: 'waterfront' })).rows.map((x) => x.name), ['Lakeside Pier Hall']);
  assert.deepEqual((await s({ sort: 'price' })).rows.map((x) => x.price_from), [2500, 4000, 9000]);
  r = await s({ limit: 2, offset: 2 });
  assert.deepEqual({ total: r.total, names: r.rows.map((x) => x.name) }, { total: 3, names: ['Lakeside Pier Hall'] });
  assert.ok(!('email' in r.rows[0]), 'no private fields');
  assert.equal(r.rows[0].has_page, true, 'has reviews, so it has its own page');
  assert.equal((await db.anon('select search_vendors($1, $2) as r', [rr, cat]))[0].r.total, 1);
});
