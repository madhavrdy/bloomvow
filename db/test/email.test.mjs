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

const sentTo = (to) => db.sql(`select body from sent_log where body->'to' ? $1 order by id`, [to]).then((r) => r.map((x) => x.body));
const tokenFrom = (html) => html.match(/\/account\/\?t=([0-9a-f]{64})/)?.[1];

test('new lead: vendor gets a short email without the customer\'s details; customer gets a confirmation with their inbox link', async () => {
  const v = await makeVendor(db, { name: 'Rose & Thistle', category: 'florists', email: 'shop@rose.test', status: 'claimed' });
  await db.anon('select submit_lead($1::jsonb)', [JSON.stringify(lead({ source: 'profile', vendor_id: v.id, city_id: await cityId(db, 'Austin'),
    couple_name: '<i>Ana</i> & Leo', email: 'ana@x.test', phone: '(512) 423-0142', message: 'Hi!\nSpring wedding', wedding_date: '2027-05-01' }))]);
  assert.equal((await run()).queued, 0, 'no key: nothing is sent');

  await db.client.query(`set bloomvow.test_email_key = 're_test'`);
  assert.equal((await run()).queued, 2);
  const [toVendor] = await sentTo('shop@rose.test');
  assert.equal(toVendor.from, 'Bloomvow <hi@bloomvow.test>');
  assert.equal(toVendor.reply_to, undefined, 'no reply-to: vendors answer on the site');
  assert.match(toVendor.subject, /^New wedding florist lead in Austin, TX$/);
  assert.match(toVendor.html, /May 2027/);
  for (const secret of ['Ana', 'ana@x.test', '423-0142', 'Spring wedding']) assert.ok(!toVendor.html.includes(secret), `vendor email must not show ${secret}`);
  assert.match(toVendor.html, /https:\/\/www\.bloomvow\.test\/vendor-dashboard\/#leads/);

  const [conf] = await sentTo('ana@x.test');
  assert.match(conf.subject, /Your request was sent to 1 vendor$/);
  assert.match(conf.html, /Hi &lt;i&gt;Ana&lt;\/i&gt;,/, 'customer input is escaped in HTML');
  const t = tokenFrom(conf.html);
  assert.ok(t, 'confirmation carries an inbox link');
  const inbox = (await db.anon('select customer_inbox($1) as r', [t]))[0].r;
  assert.equal(inbox.email, 'ana@x.test');
  assert.equal(inbox.requests.length, 1);
  assert.equal(inbox.requests[0].vendors[0].name, 'Rose & Thistle');
  assert.ok((await db.one(`select count(*)::int n from customer_tokens where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [t])).n === 1);
  assert.equal((await db.one(`select count(*)::int n from customer_tokens where token_hash = $1`, [t])).n, 0, 'only a hash is stored');
  assert.equal((await run()).queued, 0, 'pending requests are not sent twice');

  await db.sql('update sent_log set status = 200');
  assert.equal((await run()).sent, 2);

  // A rejected send is retried up to 5 attempts, then left for an admin to look at.
  await db.sql(`insert into notifications (kind, to_email, payload) values ('claim_decided', 'owner@x.test', '{"approved": true}')`);
  for (let i = 0; i < 6; i++) { await run(); await db.sql('update sent_log set status = 422 where status is null'); }
  const n = await db.one(`select attempts, sent_at, error from notifications where to_email = 'owner@x.test'`);
  assert.deepEqual({ attempts: n.attempts, sent: n.sent_at }, { attempts: 5, sent: null });
  assert.match(n.error, /422/);
  // Emails that waited more than 7 days are dropped, not sent late.
  await db.sql(`insert into notifications (kind, to_email, payload, created_at) values ('claim_decided', 'late@x.test', '{"approved": true}', now() - interval '8 days')`);
  await run();
  assert.match((await db.one(`select error from notifications where to_email = 'late@x.test'`)).error, /expired/);
  assert.equal((await sentTo('late@x.test')).length, 0);
});

test('unclaimed vendors are asked to claim to view the lead; reminders after 24h', async () => {
  const v = await makeVendor(db, { name: 'Open Data Cakes', category: 'wedding-cakes', email: 'cakes@x.test' });
  await db.anon('select submit_lead($1::jsonb)', [JSON.stringify(lead({ source: 'profile', vendor_id: v.id, city_id: await cityId(db, 'Austin'), email: 'kim@x.test' }))]);
  await run();
  const [s] = await sentTo('cakes@x.test');
  assert.match(s.html, new RegExp(`for-vendors/\\?claim=${v.id}`));
  assert.match(s.html, /Claim your free listing to view and reply/);
  assert.ok(!s.html.includes('kim@x.test'));
  await db.sql(`update lead_recipients set sent_at = now() - interval '25 hours' where vendor_id = $1`, [v.id]);
  assert.equal((await db.one('select queue_lead_reminders() as n')).n, 1);
  await db.sql('update sent_log set status = 200 where status is null');
  await run(); await run();
  const subjects = (await sentTo('cakes@x.test')).map((b) => b.subject);
  assert.match(subjects[1], /lead in Austin, TX is waiting for your reply/);
});

test('conversation: vendor reply emails the customer a link to their inbox; customer answers there and the vendor is emailed', async () => {
  const owner = await makeUser(db, 'owner@bloom.test');
  const v = await makeVendor(db, { name: 'Bloom Hall', category: 'wedding-venues', email: 'hall@bloom.test', status: 'claimed', owner_id: owner });
  const other = await makeVendor(db, { name: 'Other Hall', category: 'wedding-venues', email: 'other@x.test', status: 'claimed' });
  const r = (await db.anon('select submit_lead($1::jsonb) as r', [JSON.stringify(lead({ source: 'profile', vendor_id: v.id, city_id: await cityId(db, 'Austin'), couple_name: 'Priya Shah', email: 'Priya@x.test' }))]))[0].r;
  await db.user(owner, `select vendor_reply($1, $2, $3)`, [r.lead_id, v.id, 'Hi Priya, the date is open! Here is our pricing...']);
  await db.sql('update sent_log set status = 200 where status is null');
  await run(); await run();
  const toCustomer = (await sentTo('priya@x.test')).find((b) => /replied to your enquiry/.test(b.subject));
  assert.equal(toCustomer.subject, 'Bloom Hall replied to your enquiry');
  assert.match(toCustomer.html, /the date is open/);
  const t = tokenFrom(toCustomer.html);
  let inbox = (await db.anon('select customer_inbox($1) as r', [t]))[0].r;
  const thread = inbox.requests[0].vendors.find((x) => x.name === 'Bloom Hall');
  assert.equal(thread.unread, 1);
  assert.equal(thread.messages.at(-1).from, 'vendor');
  await db.anon('select customer_mark_read($1, $2, $3)', [t, r.lead_id, v.id]);
  await db.anon('select customer_send($1, $2, $3, $4)', [t, r.lead_id, v.id, 'Great, can we visit on Saturday?']);
  inbox = (await db.anon('select customer_inbox($1) as r', [t]))[0].r;
  assert.deepEqual(inbox.requests[0].vendors.find((x) => x.name === 'Bloom Hall').messages.map((m) => m.from), ['vendor', 'customer']);
  // The vendor sees the conversation (and only their own).
  const seen = await db.user(owner, `select sender, body from lead_messages order by id`);
  assert.deepEqual(seen.map((m) => m.sender), ['vendor', 'customer']);
  await db.sql('update sent_log set status = 200 where status is null'); await run(); await run();
  const toVendor = (await sentTo('hall@bloom.test')).find((b) => /replied about their enquiry/.test(b.subject));
  assert.equal(toVendor.subject, 'Priya replied about their enquiry');
  assert.ok(!toVendor.html.includes('Saturday'), 'message text stays on the site');
  // Not their request or vendor, bad or missing links: refused.
  await assert.rejects(db.anon('select customer_send($1, $2, $3, $4)', [t, r.lead_id, other.id, 'hi']), /not_found/);
  await assert.rejects(db.anon('select customer_inbox($1)', ['0'.repeat(64)]), /invalid_link/);
  await assert.rejects(db.anon('select customer_inbox($1)', ['nope']), /invalid_link/);
  await db.sql(`update customer_tokens set expires_at = now() - interval '1 day'`);
  await assert.rejects(db.anon('select customer_inbox($1)', [t]), /invalid_link/, 'expired link');
  await assert.rejects(db.anon('select * from lead_messages'), /permission denied/);
  await assert.rejects(db.anon('select * from customer_tokens'), /permission denied/);
});

test('"email me a link" only for addresses with a request, at most 3 an hour, same answer either way', async () => {
  const before = (await db.one(`select count(*)::int n from notifications where kind = 'customer_link'`)).n;
  await db.anon('select customer_request_link($1)', ['nobody@x.test']);
  for (let i = 0; i < 5; i++) await db.anon('select customer_request_link($1)', [' KIM@x.test ']);
  assert.equal((await db.one(`select count(*)::int n from notifications where kind = 'customer_link'`)).n - before, 3);
  await assert.rejects(db.anon('select customer_request_link($1)', ['not an email']), /invalid_email/);
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
