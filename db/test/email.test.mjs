import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeVendor, cityId, lead, makeUser } from './helpers.mjs';

let db;
before(async () => {
  db = await freshDb('bv_test_email');
  // Stand-ins for pg_net: record what would be sent; results are set by the test.
  await db.sql(`create table sent_log (id bigserial primary key, body jsonb, key text, status int)`);
  await db.sql(`create or replace function email_http_post(body jsonb, api_key text) returns bigint language sql as
    $$ insert into sent_log (body, key) values (body, api_key) returning id $$`);
  await db.sql(`create or replace function email_http_result(rid bigint, out ok boolean, out err text) language sql as
    $$ select case when status is null then null else status between 200 and 299 end, case when status >= 300 then status || ' rejected' end from sent_log where id = rid $$`);
  await db.sql(`update settings set value = '"Bloomvow <hi@bloomvow.test>"' where key = 'email_from'`);
  await db.sql(`update settings set value = '"https://www.bloomvow.test"' where key = 'site_url'`);
});
after(() => db?.close());
const run = () => db.sql('select send_pending_emails() as r').then((r) => r[0].r);

test('lead emails: wait without a key, then send with reply-to the couple; failures retry, then stop', async () => {
  const v = await makeVendor(db, { name: 'Rose & Thistle', category: 'florists', email: 'shop@rose.test', status: 'claimed' });
  await db.anon('select submit_lead($1::jsonb)', [JSON.stringify(lead({ source: 'profile', vendor_id: v.id, city_id: await cityId(db, 'Austin'),
    couple_name: 'Ana <b>& Leo', email: 'ana@x.test', message: 'Hi!\nSpring wedding', wedding_date: '2027-05-01' }))]);
  assert.equal((await run()).queued, 0, 'no key: nothing is sent');

  await db.client.query(`set bloomvow.test_email_key = 're_test'`);
  assert.equal((await run()).queued, 1);
  const [s] = await db.sql('select * from sent_log');
  assert.equal(s.key, 're_test');
  assert.deepEqual(s.body.to, ['shop@rose.test']);
  assert.equal(s.body.reply_to, 'ana@x.test');
  assert.equal(s.body.from, 'Bloomvow <hi@bloomvow.test>');
  assert.match(s.body.subject, /New wedding enquiry from Ana <b>& Leo for May 1, 2027/);
  assert.match(s.body.html, /Ana &lt;b&gt;&amp; Leo/, 'couple input is escaped in HTML');
  assert.match(s.body.html, /Hi!<br>Spring wedding/);
  assert.match(s.body.html, /https:\/\/www\.bloomvow\.test\/vendor-dashboard\//);
  assert.equal((await run()).queued, 0, 'pending request is not sent twice');

  await db.sql('update sent_log set status = 200');
  assert.equal((await run()).sent, 1);
  assert.ok((await db.one(`select sent_at from notifications where to_email = 'shop@rose.test'`)).sent_at);

  // A rejected send is retried up to 5 attempts, then left for an admin to look at.
  await db.sql(`insert into notifications (kind, to_email, payload) values ('claim_decided', 'owner@x.test', '{"approved": true}')`);
  for (let i = 0; i < 6; i++) { await run(); await db.sql('update sent_log set status = 422 where status is null'); }
  const n = await db.one(`select attempts, sent_at, error from notifications where to_email = 'owner@x.test'`);
  assert.deepEqual({ attempts: n.attempts, sent: n.sent_at }, { attempts: 5, sent: null });
  assert.match(n.error, /422/);
});

test('unclaimed vendors get a claim link; reminders after 24h', async () => {
  const v = await makeVendor(db, { name: 'Open Data Cakes', category: 'wedding-cakes', email: 'cakes@x.test' });
  await db.anon('select submit_lead($1::jsonb)', [JSON.stringify(lead({ source: 'profile', vendor_id: v.id, city_id: await cityId(db, 'Austin'), email: 'kim@x.test' }))]);
  await run();
  const [s] = await db.sql(`select body from sent_log where body->'to' ? 'cakes@x.test'`);
  assert.match(s.body.html, new RegExp(`for-vendors/\\?claim=${v.id}`));
  await db.sql(`update lead_recipients set sent_at = now() - interval '25 hours' where vendor_id = $1`, [v.id]);
  assert.equal((await db.one('select queue_lead_reminders() as n')).n, 1);
  await db.sql('update sent_log set status = 200 where status is null');
  await run(); await run();
  const kinds = (await db.sql(`select body->>'subject' s from sent_log where body->'to' ? 'cakes@x.test' order by id`)).map((r) => r.s);
  assert.match(kinds[1], /Reminder: .* is waiting for your reply/);
});

test('event rollup keeps daily totals and deletes old raw rows; jobs are not callable from the API', async () => {
  const v = await makeVendor(db, { name: 'Rollup Venue', category: 'wedding-venues' });
  await db.sql(`insert into events (vendor_id, kind, created_at) select $1, 'view', now() - interval '200 days' from generate_series(1, 7)`, [v.id]);
  await db.sql(`insert into events (vendor_id, kind) values ($1, 'view')`, [v.id]);
  assert.equal((await db.one('select rollup_events() as n')).n, 7);
  assert.equal((await db.one('select sum(n)::int n from event_daily where vendor_id = $1', [v.id])).n, 7);
  assert.equal((await db.one('select count(*)::int n from events where vendor_id = $1', [v.id])).n, 1);
  const u = await makeUser(db, 'someone@x.test');
  for (const f of ['send_pending_emails()', 'rollup_events()']) {
    await assert.rejects(db.anon(`select ${f}`), /permission denied/);
    await assert.rejects(db.user(u, `select ${f}`), /permission denied/);
  }
});
