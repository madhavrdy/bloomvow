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
  await assert.rejects(set('anon', null, good), /permission denied/, 'visitors cannot change settings at all');
  assert.deepEqual((await db.one(`select value from settings where key = 'tracking'`)).value, {});
});

test('own analytics: anonymous hits with source and device, admin-only report with channels and lead attribution', async () => {
  const admin = await makeUser(db, 'stats@site.test', 'admin');
  const vendor = await makeUser(db, 'v2@site.test');
  const hit = (p) => db.anon('select track_hit($1::jsonb)', [JSON.stringify(p)]);
  await hit({ kind: 'page_view', path: '/blog/a/', vid: 'visitor0001', sid: 'session0001', ref: 'www.google.com', dev: 'mobile' });
  await hit({ kind: 'page_view', path: '/get-matched/', vid: 'visitor0001', sid: 'session0001', ref: 'celebrateio.com', dev: 'mobile' });
  await hit({ kind: 'lead_start', path: '/get-matched/', vid: 'visitor0001', sid: 'session0001' });
  await hit({ kind: 'lead', path: '/get-matched/', vid: 'visitor0001', sid: 'session0001' });
  await hit({ kind: 'page_view', path: '/blog/a/', vid: 'visitor0002', sid: 'session0002', us: 'Newsletter', um: 'email', uc: 'nov<script>', dev: 'desktop' });
  await hit({ kind: 'page_view', path: '/blog/b/', vid: 'visitor0003', sid: 'session0003', dev: 'tablet' });
  // Junk is dropped or cleaned, never stored as given.
  await hit({ kind: 'page_view', path: 'javascript:alert(1)', vid: 'x' });
  await hit({ kind: 'page_view', path: '/blog/c/', vid: 'BAD ID!', sid: "'; drop", ref: '<b>', dev: 'phone' });
  await assert.rejects(hit({ kind: 'impression', path: '/x/' }), /invalid_kind/);
  await hit({ kind: 'view', path: '/vendor/x/' });   // a vendor view needs a vendor
  const junk = await db.one(`select visitor_id, session_id, referrer, device from events where page_path = '/blog/c/'`);
  assert.deepEqual(junk, { visitor_id: null, session_id: null, referrer: null, device: null });
  assert.equal((await db.one(`select utm_campaign from events where visitor_id = 'visitor0002'`)).utm_campaign, 'novscript');
  assert.equal((await db.one(`select referrer from events where page_path = '/get-matched/' and kind = 'page_view'`)).referrer, null, 'own site is not a source');

  const r = (await db.user(admin, 'select admin_analytics(7) as r'))[0].r;
  assert.equal(r.kpi.visitors, 3);
  assert.equal(r.kpi.sessions, 3);
  assert.equal(r.kpi.pageviews, 5);
  assert.equal(r.kpi.form_starts, 1);
  const ch = Object.fromEntries(r.channels.map((c) => [c.channel, c]));
  assert.equal(ch.Search.sessions, 1);
  assert.equal(ch.Search.leads, 1, 'the lead is credited to the session that came from Google');
  assert.equal(ch.Email.sessions, 1);
  assert.equal(ch.Direct.sessions, 1);
  assert.deepEqual(r.funnel, { sessions: 3, started: 1, sent: 1 });
  assert.equal(r.pages[0].path, '/blog/a/');
  assert.equal(r.pages[0].visitors, 2);
  assert.equal(r.series.length, 7);
  assert.deepEqual(r.devices.map((d) => d.device).sort(), ['desktop', 'mobile', 'tablet']);
  await assert.rejects(db.user(vendor, 'select admin_analytics(7)'), /forbidden/);
  await assert.rejects(db.anon('select admin_analytics(7)'), /permission denied/);
});
