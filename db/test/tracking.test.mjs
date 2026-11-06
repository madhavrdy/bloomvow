import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser } from './helpers.mjs';

let db;
before(async () => { db = await freshDb('bv_test_tracking'); });
after(() => db?.close());
const set = (as, uid, v) => db.as(as, uid, `update settings set value = $1::jsonb where key = 'tracking' returning value`, [JSON.stringify(v)]);
const good = { ga4: 'G-AB12CD34EF', gtm: 'GTM-K9X2PQ', google_ads: 'AW-123456789', google_ads_lead_label: 'AbC-dEf_123', meta_pixel: '1234567890123456', gsc: 'x1Yz_ABCdef-ghiJKLmno12345', bing: '0123456789ABCDEF0123456789ABCDEF' };

test('tracking IDs: admins save them, values are format-checked, others cannot change them', async () => {
  const admin = await makeUser(db, 'boss@site.test', 'admin');
  const editor = await makeUser(db, 'ed@site.test', 'editor');
  const vendor = await makeUser(db, 'v@site.test');
  assert.deepEqual((await db.anon(`select value from settings where key = 'tracking'`))[0].value, {}, 'empty by default, public to read');
  assert.deepEqual((await set('authenticated', admin, good))[0].value, good);
  assert.deepEqual((await set('authenticated', admin, {}))[0].value, {}, 'clearing everything is allowed');
  for (const bad of [
    { ga4: 'UA-12345-1' }, { ga4: 'G-ab"><script>' }, { gtm: 'GTM-<x>' }, { google_ads: 'AW-12a' },
    { google_ads_lead_label: 'a b' }, { meta_pixel: '12ab' }, { gsc: '<meta name="google-site-verification">' },
    { bing: 'zzzz9999' }, { custom_script: 'alert(1)' },
  ]) await assert.rejects(set('authenticated', admin, bad), /settings_tracking_check/, JSON.stringify(bad));
  for (const uid of [editor, vendor]) assert.equal((await set('authenticated', uid, good)).length, 0, 'not an admin: nothing changes');
  assert.equal((await set('anon', null, good)).length, 0);
  assert.deepEqual((await db.one(`select value from settings where key = 'tracking'`)).value, {});
});
