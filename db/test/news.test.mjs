// News & updates: only credible, relevant, non-tragic, recent items are kept; pages get the most
// specific items first; targets run daily for a week, then weekly; only admins can change items.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, cityId } from './helpers.mjs';

let db, admin, vendor, austin, venues;
before(async () => {
  db = await freshDb('bv_test_news');
  admin = await makeUser(db, 'news-admin@site.test', 'admin');
  vendor = await makeUser(db, 'news-vendor@site.test');
  austin = await cityId(db, 'Austin');
  venues = (await db.one(`select id from categories where slug = 'wedding-venues'`)).id;
});
after(() => db?.close());

const day = (d) => new Date(Date.now() - d * 86400000).toUTCString();
const item = (title, src, url, ago = 1, link = `https://news.google.com/rss/articles/${Math.random().toString(36).slice(2)}`) =>
  `<item><title>${title} - ${src}</title><link>${link}</link><pubDate>${day(ago)}</pubDate><source url="${url}">${src}</source></item>`;
const rss = (...items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join('')}</channel></rss>`;

test('only credible, relevant, recent and non-tragic headlines are kept', async () => {
  const t = await db.one(`select * from news_targets where city_id = $1 and category_id is null`, [austin]);
  const body = rss(
    item('New Austin wedding venue opens in former train depot', 'Austin American-Statesman', 'https://www.statesman.com'),
    item('Austin couple&#39;s wedding goes viral', 'Some Blog', 'https://randomblog.example'),            // not credible
    item('Austin wedding guests injured in bus crash', 'KXAN', 'https://www.kxan.com'),                 // tragedy
    item('Austin restaurant week returns', 'Austin American-Statesman', 'https://www.statesman.com'),   // not about weddings
    item('Dallas wedding venue adds rooftop', 'The Dallas Morning News', 'https://www.dallasnews.com'),  // not this city
    item('Austin bridal show returns this January', 'KXAN', 'https://www.kxan.com', 40),               // too old
    item('Austin venue owner charged with fraud', 'KXAN', 'https://www.kxan.com'),                     // blocked word
    item('Austin wedding season: five event spaces booking fast', 'CultureMap Austin', 'https://austin.culturemap.com'),
    item('Austin wedding season: five event spaces are booking fast', 'KXAN', 'https://www.kxan.com'),         // same story twice
    item('Austin wedding planner wins People Exclusive award', 'Austin American-Statesman', 'https://www.statesman.com'), // celebrity/tabloid cue
    item('Austin wedding venue evacuated', 'KXAN', 'https://www.kxan.com'),                                    // word stem
    item('Austin wedding fair this weekend', 'KXAN', 'https://www.kxan.com'),
  );
  const n = (await db.one(`select news_parse(t, $2) as n from news_targets t where t.id = $1`, [t.id, body])).n;
  assert.equal(n, 3);
  const titles = (await db.sql(`select title, source_name, city_id, status from news_items order by title`));
  assert.deepEqual(titles.map((x) => x.title), ['Austin wedding fair this weekend', 'Austin wedding season: five event spaces booking fast', 'New Austin wedding venue opens in former train depot']);
  assert.ok(titles.every((x) => x.city_id === austin && x.status === 'published'));
  // The same headline again is not added twice.
  assert.equal((await db.one(`select news_parse(t, $2) as n from news_targets t where t.id = $1`, [t.id, body])).n, 0);
  // Approval on: new items wait for an admin.
  await db.sql(`update settings set value = value || '{"approval": true}' where key = 'news'`);
  await db.one(`select news_parse(t, $2) as n from news_targets t where t.id = $1`, [t.id, rss(item('Austin wedding planners share 2027 trends', 'KXAN', 'https://www.kxan.com'))]);
  assert.equal((await db.one(`select status from news_items where title like 'Austin wedding planners%'`)).status, 'pending');
  await db.sql(`update settings set value = value || '{"approval": false}' where key = 'news'`);
});

test('national pages only take national sources; local papers count only for their own city', async () => {
  const t = await db.one(`select * from news_targets where category_id = $1 and city_id is null`, [venues]);
  const body = rss(
    item('New wedding venue opens in Ohio barn', 'Patch', 'https://patch.com'),                         // local source
    item('Event venue trends for 2027 weddings', 'BizBash', 'https://www.bizbash.com'),                 // national
    item('Wedding venue directory picks', 'The Knot', 'https://www.theknot.com'),                        // competitor, not listed
  );
  assert.equal((await db.one(`select news_parse(t, $2) as n from news_targets t where t.id = $1`, [t.id, body])).n, 1);
  assert.ok((await db.one(`select count(*)::int n from news_items where title = 'Event venue trends for 2027 weddings'`)).n === 1);
  const cfg = (await db.one(`select value from settings where key = 'news'`)).value;
  assert.ok(![...cfg.sources, ...cfg.local_sources].some((d) => /theknot|weddingwire|zola/.test(d)), 'no competitor directories');
});

test('pages get the most specific items first, only published and recent ones', async () => {
  await db.sql(`insert into news_items (title, url, source_name, published_at, city_id, category_id, origin) values
    ('Venue news for Austin', 'https://x.test/1', 'KXAN', now() - interval '2 days', $1, $2, 'manual'),
    ('National venue trend', 'https://x.test/2', 'Brides', now() - interval '1 day', null, $2, 'manual'),
    ('Hidden item', 'https://x.test/3', 'KXAN', now(), $1, $2, 'manual'),
    ('Old item', 'https://x.test/4', 'KXAN', now() - interval '100 days', $1, $2, 'manual')`, [austin, venues]);
  await db.sql(`update news_items set status = 'hidden' where title = 'Hidden item'`);
  const r = (await db.anon('select news_for($1, $2, 8) as r', [austin, venues]))[0].r;
  assert.equal(r[0].title, 'Venue news for Austin');
  assert.ok(!r.some((x) => /Hidden|Old/.test(x.title)));
  assert.ok(r.findIndex((x) => x.title === 'National venue trend') > r.findIndex((x) => /Austin wedding/.test(x.title)), 'city news before national');
  // Visitors only ever see published items.
  const seen = await db.anon(`select title from news_items`);
  assert.ok(!seen.some((x) => x.title === 'Hidden item'));
});

test('admins edit, hide and delete; nobody else can', async () => {
  const [{ id }] = await db.sql(`select id from news_items where title = 'National venue trend'`);
  await db.user(admin, `update news_items set title = 'National venue trends for 2027', summary = 'Short note' where id = $1`, [id]);
  assert.equal((await db.one(`select title from news_items where id = $1`, [id])).title, 'National venue trends for 2027');
  await assert.rejects(db.anon(`update news_items set title = 'x' where id = $1`, [id]), /permission denied/);
  const r = await db.user(vendor, `update news_items set title = 'hacked' where id = $1 returning id`, [id]);
  assert.equal(r.length, 0, 'RLS: a vendor changes nothing');
  await db.user(admin, `delete from news_items where id = $1`, [id]);
  assert.equal((await db.sql(`select 1 from news_items where id = $1`, [id])).length, 0);
  await assert.rejects(db.anon(`select * from news_targets`), /permission denied/);
  await assert.rejects(db.user(vendor, `select admin_news_refresh()`), /forbidden/);
  await assert.rejects(db.user(admin, `update settings set value = '{"sources": ["not a domain"]}' where key = 'news'`), /check constraint/);
});

test('targets: daily during the first week, then weekly', async () => {
  const due = async (first, last) => (await db.one(`select news_target_due(t) as d from (select (n).* from (select row(0, null::int, null::int, 'q', 're', $1::timestamptz, $2::timestamptz, null::bigint, 0, true)::news_targets as n) z) t`, [first, last])).d;
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  assert.equal(await due(null, null), true, 'never run');
  assert.equal(await due(ago(48), ago(21)), true, 'first week, last run 21h ago');
  assert.equal(await due(ago(48), ago(5)), false, 'first week, ran 5h ago');
  assert.equal(await due(ago(24 * 10), ago(24 * 3)), false, 'second week, ran 3 days ago');
  assert.equal(await due(ago(24 * 10), ago(24 * 7)), true, 'second week, ran 7 days ago');
});

test('internal news functions cannot be called by signed-in users', async () => {
  for (const f of ['select news_fetch()', 'select news_seed_targets()']) {
    await assert.rejects(db.user(vendor, f), /permission denied/);
    await assert.rejects(db.anon(f), /permission denied/);
  }
  await assert.rejects(db.user(vendor, `select news_parse((select t from news_targets t limit 1), '<rss/>')`), /permission denied/);
});

test('AI takeaways: drafted only with a key, wait for review, never shown until an admin uses them', async () => {
  // Stand-ins for pg_net: record what would be sent; answers are set by the test.
  await db.sql(`create table ai_log (id bigserial primary key, body jsonb, key text, status int, answer text)`);
  await db.sql(`create or replace function news_ai_post(body jsonb, api_key text) returns bigint language sql as
    $$ insert into ai_log (body, key) values (body, api_key) returning id $$`);
  await db.sql(`create or replace function news_ai_result(rid bigint, out status int, out body text) language sql as
    $$ select status, answer from ai_log where id = rid $$`);
  await db.sql(`delete from news_items`);
  await db.sql(`insert into news_items (title, url, source_name, published_at, city_id, category_id, origin) values
    ('New Austin wedding venue opens downtown', 'https://x.test/a1', 'KXAN', now(), $1, null, 'auto'),
    ('Wedding venue trends for 2027', 'https://x.test/a2', 'Brides', now(), null, $2, 'auto'),
    ('Austin bride and groom profile', 'https://x.test/a3', 'KXAN', now(), $1, null, 'auto'),
    ('Austin venue added by hand', 'https://x.test/a4', 'KXAN', now(), $1, null, 'manual'),
    ('Austin event space news', 'https://x.test/a5', 'KXAN', now(), $1, null, 'auto'),
    ('Austin hotel ballroom news', 'https://x.test/a6', 'KXAN', now(), $1, null, 'auto')`, [austin, venues]);
  const step = () => db.one('select news_ai_step() as r').then((x) => x.r);

  assert.equal((await step()).asked, 0, 'no key: nothing is sent');
  await db.client.query(`set bloomvow.test_ai_key = 'sk-test'`);
  assert.equal((await step()).asked, 5, 'automatic items only');
  const sent = await db.sql(`select a.id, a.body, a.key, n.title from ai_log a join news_items n on n.ai_request_id = a.id order by a.id`);
  assert.equal(sent[0].key, 'sk-test');
  assert.equal(sent[0].body.model, 'claude-sonnet-5-5');
  assert.match(sent[0].body.system, /Never invent/);
  const prompt = sent.find((s) => s.title.startsWith('New Austin')).body.messages[0].content;
  assert.match(prompt, /Headline: New Austin wedding venue opens downtown/);
  assert.match(prompt, /Shown on: wedding vendor pages for Austin, Texas/);
  assert.match(sent.find((s) => s.title.startsWith('Wedding venue trends')).body.messages[0].content, /wedding venues pages for US cities/);

  const answer = (title, status, text) => db.sql(`update ai_log set status = $2, answer = $3 where id = (select ai_request_id from news_items where title = $1)`,
    [title, status, JSON.stringify({ content: [{ type: 'text', text }] })]);
  await answer('New Austin wedding venue opens downtown', 200, '"A new option for spring dates: ask about opening offers and how far ahead weekends are booking."');
  await answer('Wedding venue trends for 2027', 200, 'Worth a look before you tour venues; compare what each includes.');
  await answer('Austin bride and groom profile', 200, 'SKIP');
  await answer('Austin event space news', 200, 'Book early, see www.example.com for details on this.');
  await db.sql(`update ai_log set status = 529, answer = '{}' where id = (select ai_request_id from news_items where title = 'Austin hotel ballroom news')`);
  const r = await step();
  assert.equal(r.drafted, 2);
  const st = Object.fromEntries((await db.sql(`select title, ai_status, ai_draft, summary from news_items`)).map((x) => [x.title, x]));
  assert.equal(st['New Austin wedding venue opens downtown'].ai_status, 'review');
  assert.equal(st['New Austin wedding venue opens downtown'].ai_draft, 'A new option for spring dates: ask about opening offers and how far ahead weekends are booking.');
  assert.equal(st['New Austin wedding venue opens downtown'].summary, null, 'not shown until approved');
  assert.equal(st['Austin bride and groom profile'].ai_status, 'skipped');
  assert.equal(st['Austin event space news'].ai_status, 'skipped', 'links are not allowed');
  assert.equal(st['Austin venue added by hand'].ai_status, null);
  assert.equal(st['Austin hotel ballroom news'].ai_status, 'asked', 'overloaded: asked again');
  assert.equal(r.asked, 1);

  // Visitors never see drafts; an admin uses one and it becomes the summary.
  const pub = (await db.anon('select news_for($1, $2, 8) as r', [austin, venues]))[0].r;
  assert.ok(pub.every((x) => x.summary === null));
  await db.user(admin, `update news_items set summary = ai_draft, ai_status = 'approved' where title = 'New Austin wedding venue opens downtown'`);
  const pub2 = (await db.anon('select news_for($1, $2, 8) as r', [austin, venues]))[0].r;
  assert.match(pub2.find((x) => x.title.startsWith('New Austin')).summary, /opening offers/);
  const s = (await db.user(admin, 'select admin_news_ai_status() as s'))[0].s;
  assert.equal(s.key_saved, true); assert.equal(s.to_review, 1);
  await assert.rejects(db.user(vendor, 'select admin_news_ai_status()'), /forbidden/);
  await assert.rejects(db.anon('select news_ai_step()'), /permission denied/);

  // Monthly cap.
  await db.sql(`update settings set value = value || '{"ai_monthly_cap": 0}' where key = 'news'`);
  await db.sql(`update news_items set ai_status = null where title = 'Austin venue added by hand'`);
  await db.sql(`insert into news_items (title, url, source_name, published_at, city_id, origin) values ('Austin wedding fair returns', 'https://x.test/a7', 'KXAN', now(), $1, 'auto')`, [austin]);
  assert.equal((await step()).asked, 0, 'cap reached');
  await assert.rejects(db.user(admin, `update settings set value = value || '{"ai_model": "gpt-4"}' where key = 'news'`), /check constraint/);
  await db.client.query(`reset bloomvow.test_ai_key`);
});
