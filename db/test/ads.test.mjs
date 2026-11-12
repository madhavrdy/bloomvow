import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor, makeUser, cityId, catId } from './helpers.mjs';

let db, admin, austin, dallas, venues, florists, free, featured;
const ads = (places, city = null, cat = null, vendor = null) =>
  db.anon('select ads_for($1::text[], $2, $3, $4) as r', [places, city, cat, vendor]).then((r) => r[0].r);
const banner = (o) => db.user(admin,
  `insert into ad_campaigns (name, image_url, link_url, alt, placements, city_id, category_id, region_id, starts_on, ends_on, weight, active)
   values ($1, $2, 'https://sponsor.example/', 'Sponsor', $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
  [o.name, `https://img.example/${o.name}.webp`, o.placements ?? ['city_top'], o.city ?? null, o.category ?? null, o.region ?? null,
   o.starts ?? null, o.ends ?? null, o.weight ?? 1, o.active ?? true]).then((r) => r[0].id);
const setAds = (v) => db.user(admin, `update settings set value = $1 where key = 'ads'`, [JSON.stringify(v)]);

before(async () => {
  db = await freshDb('bv_test_ads');
  admin = await makeUser(db, 'boss@site.test', 'admin');
  austin = await cityId(db, 'Austin'); dallas = await cityId(db, 'Dallas');
  venues = await catId(db, 'wedding-venues'); florists = await catId(db, 'florists');
  free = await makeVendor(db, { name: 'Free Hall' });
  featured = await makeVendor(db, { name: 'Paid Hall', plan: 'featured', status: 'claimed' });
});
after(() => db?.close());

test('nothing set up: every slot stays empty', async () => {
  assert.deepEqual(await ads(['city_top', 'post_intro'], austin, venues), { client: null, slots: {}, sponsors: {} });
});

test('AdSense fills enabled placements; switched-off ones stay empty', async () => {
  await setAds({ client: 'ca-pub-1234567890123456', slots: { city_top: '1111111111', post_intro: '2222222222', post_mid: '3333333333' }, off: ['post_mid'] });
  const r = await ads(['city_top', 'post_intro', 'post_mid', 'post_end']);
  assert.equal(r.client, 'ca-pub-1234567890123456');
  assert.deepEqual(r.slots, { city_top: '1111111111', post_intro: '2222222222' });
});

test('sponsor banners: targeting, dates, most specific first', async () => {
  const anyCity = await banner({ name: 'everywhere' });
  const austinVenues = await banner({ name: 'austin-venues', city: austin, category: venues });
  await banner({ name: 'expired', city: austin, ends: '2020-01-01' });
  await banner({ name: 'off', city: austin, active: false });
  await banner({ name: 'future', city: austin, starts: '2099-01-01' });
  assert.equal((await ads(['city_top'], austin, venues)).sponsors.city_top.id, austinVenues, 'city + category beats a catch-all');
  assert.equal((await ads(['city_top'], austin, florists)).sponsors.city_top.id, anyCity, 'wrong category falls back');
  assert.equal((await ads(['city_top'], dallas, venues)).sponsors.city_top.id, anyCity, 'other city falls back');
  assert.equal((await ads(['city_top'], austin, null)).sponsors.city_top.id, austinVenues, 'city overview page matches any category');
  assert.equal((await ads(['city_list'], austin, venues)).sponsors.city_list, undefined, 'only booked placements');
  assert.equal((await ads(['post_intro'], austin, venues)).sponsors.post_intro, undefined, 'no sponsors on the blog');
});

test('featured vendors get no ads; free ones do', async () => {
  await banner({ name: 'vendor-side', placements: ['vendor_page'] });
  assert.ok((await ads(['vendor_page'], austin, venues, free.id)).sponsors.vendor_page);
  assert.deepEqual(await ads(['vendor_page'], austin, venues, featured.id), { client: null, slots: {}, sponsors: {} });
});

test('views and clicks are counted per banner per day', async () => {
  const id = await banner({ name: 'counted' });
  for (const k of ['view', 'view', 'click', 'nonsense']) await db.anon('select track_ad($1, $2)', [id, k]);
  await db.anon('select track_ad($1, $2)', ['00000000-0000-0000-0000-000000000000', 'view']);
  const [s] = await db.sql('select views, clicks from ad_stats where ad_id = $1', [id]);
  assert.deepEqual([s.views, s.clicks], [2, 1]);
});

test('only admins manage ads; settings accept only IDs and ads.txt lines', async () => {
  const u = await makeUser(db, 'editor@site.test', 'editor');
  await assert.rejects(db.anon(`select * from ad_campaigns`), /permission denied/);
  assert.equal((await db.user(u, 'select * from ad_campaigns')).length, 0, 'non-admins see nothing');
  await assert.rejects(db.user(u, `insert into ad_campaigns (name, image_url, link_url, alt, placements) values ('x', 'https://a.b/c.png', 'https://a.b', 'xx', '{city_top}')`), /row-level security/);
  await assert.rejects(setAds({ client: '<script>' }), /settings_ads_check/);
  await assert.rejects(setAds({ client: 'ca-pub-1234567890123456', slots: { city_top: 'abc' } }), /settings_ads_check/);
  await assert.rejects(setAds({ client: 'ca-pub-1234567890123456', slots: { header: '1234567' } }), /settings_ads_check/);
  await assert.rejects(setAds({ ads_txt: '<script>alert(1)</script>' }), /settings_ads_check/);
  await setAds({ client: 'ca-pub-1234567890123456', ads_txt: '# partners\nexample-network.com, 12345, RESELLER, abc123' });
  await assert.rejects(db.user(admin, `insert into ad_campaigns (name, image_url, link_url, alt, placements) values ('x', 'javascript:alert(1)', 'https://a.b', 'xx', '{city_top}')`), /check/);
  await assert.rejects(db.user(admin, `insert into ad_campaigns (name, image_url, link_url, alt, placements) values ('x', 'https://a.b/c.png', 'https://a.b', 'xx', '{post_intro}')`), /check/);
});
