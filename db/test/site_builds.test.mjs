import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser } from './helpers.mjs';

let db, editor, vendor, cat;
before(async () => {
  db = await freshDb('bv_test_site_builds');
  editor = await makeUser(db, 'writer@site.test', 'editor');
  vendor = await makeUser(db, 'shop@vendor.test');
  cat = (await db.one(`select id from blog_categories where slug = 'budget'`)).id;
  // Stand-in for pg_net: record what would be sent to GitHub.
  await db.sql(`create table gh_log (id bigserial primary key, token text)`);
  await db.sql(`create or replace function github_dispatch_post(token text) returns bigint language sql as
    $$ insert into gh_log (token) values (token) returning id $$`);
});
after(() => db?.close());
const run = () => db.sql('select send_site_build() as r').then((r) => r[0].r);
const sent = () => db.sql('select count(*)::int n from gh_log').then((r) => r[0].n);
const post = (slug, status, when = 'now()') => db.user(editor,
  `insert into posts (slug, title, body, category_id, status, published_at) values ($1, $1, 'Body text here', $2, $3, ${when}) returning id`, [slug, cat, status]);

test('drafts never trigger a rebuild; publishing queues exactly one', async () => {
  await post('a-draft', 'draft', 'null');
  assert.equal(await run(), 'nothing queued');
  await post('first-post', 'published');
  await db.user(editor, `update posts set title = 'First post!' where slug = 'first-post'`);   // a quick second save
  assert.equal((await db.one('select count(*)::int n from site_builds where sent_at is null')).n, 1, 'one waiting request is enough');
  assert.match(await run(), /no github_deploy_token/, 'waits without a token');
  assert.equal(await sent(), 0);

  await db.client.query(`set bloomvow.test_github_token = 'ghp_test'`);
  assert.equal(await run(), 'sent');
  assert.equal((await db.one('select token from gh_log')).token, 'ghp_test');
  assert.equal(await run(), 'nothing queued', 'sent once');
});

test('editing or unpublishing a live post rebuilds; future scheduled posts wait for their time', async () => {
  const before = await sent();
  await db.user(editor, `update posts set status = 'draft', published_at = null where slug = 'first-post'`);
  assert.equal(await run(), 'sent');
  await post('later', 'scheduled', `now() + interval '2 hours'`);
  assert.equal(await run(), 'nothing queued', 'not live yet');
  await db.sql(`update posts set published_at = now() - interval '1 minute' where slug = 'later'`);   // its time comes
  // The direct update above already queues; clear it to prove the minute job finds scheduled posts itself.
  await db.sql(`delete from site_builds where sent_at is null`);
  await db.sql(`update site_builds set sent_at = now() - interval '5 minutes'`);
  assert.equal(await run(), 'sent', 'scheduled post reaching its time triggers a rebuild');
  assert.equal(await sent(), before + 2);
});

test('admin: status and "update now" are for editors only', async () => {
  const s = await db.user(editor, 'select request_site_build() as r').then((r) => r[0].r);
  assert.equal(s.ready, true);
  assert.ok(s.waiting_since);
  await assert.rejects(db.user(vendor, 'select site_build_status()'), /forbidden/);
  await assert.rejects(db.anon('select request_site_build()'), /permission denied/);
  await assert.rejects(db.user(editor, 'select send_site_build()'), /permission denied/);
});
