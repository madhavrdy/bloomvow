import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, makeVendor, cityId, catId, lead } from './helpers.mjs';

let db, admin, editor, vendor, budget, venues, postId;
const comment = (p) => db.anon('select submit_comment($1::jsonb) as r', [JSON.stringify(p)]).then((r) => r[0].r);
const c = (o = {}) => ({ post_id: postId, name: 'Maya', email: `m${Math.random().toString(36).slice(2, 7)}@x.com`, body: 'Such a helpful guide, thank you!', ...o });

before(async () => {
  db = await freshDb('bv_test_blog');
  admin = await makeUser(db, 'admin@bloomvow.test', 'admin');
  editor = await makeUser(db, 'writer@bloomvow.test', 'editor');
  vendor = await makeUser(db, 'v@x.test');
  budget = (await db.one(`select id from blog_categories where slug = 'budget'`)).id;
  venues = (await db.one(`select id from blog_categories where slug = 'venues'`)).id;
});
after(() => db?.close());

test('9 starter blog categories; editors create, rename, reorder and hide; vendors and public cannot', async () => {
  assert.equal((await db.anon('select * from public_blog_categories')).length, 9);
  await db.user(editor, `insert into blog_categories (slug, name, sort) values ('honeymoon', 'Honeymoon', 95)`);
  await db.user(editor, `update blog_categories set name = 'Honeymoons & travel', sort = 5 where slug = 'honeymoon'`);
  const first = (await db.anon('select name from public_blog_categories order by sort limit 1'))[0];
  assert.equal(first.name, 'Honeymoons & travel');
  await db.user(editor, `update blog_categories set active = false where slug = 'honeymoon'`);
  assert.equal((await db.anon(`select 1 from public_blog_categories where slug = 'honeymoon'`)).length, 0, 'hidden from site');
  await assert.rejects(db.user(vendor, `insert into blog_categories (slug, name) values ('x-y', 'Xy')`), /row-level security/);
  await assert.rejects(db.anon(`insert into blog_categories (slug, name) values ('x-z', 'Xz')`), /row-level security|permission denied/);
  await assert.rejects(db.user(editor, `insert into blog_categories (slug, name) values ('Bad Slug', 'Bad')`), /check constraint/);
});

test('posts: draft is private, scheduled appears at its time, published is public', async () => {
  const [p] = await db.user(editor, `insert into posts (slug, title, body, category_id, author_name) values
    ('austin-venue-costs', 'How much does a wedding venue cost in Austin?', '## Prices\\nMost venues…', $1, 'Writer') returning id`, [budget]);
  postId = p.id;
  assert.equal((await db.anon('select * from public_posts')).length, 0, 'drafts are hidden');
  await assert.rejects(db.anon('select * from posts'), /permission denied/);
  await assert.rejects(db.user(vendor, `insert into posts (slug, title, category_id) values ('v-post', 'Vendor post', $1)`, [budget]), /row-level security/);
  await assert.rejects(db.user(editor, `update posts set status = 'published' where id = $1`, [postId]), /check constraint/, 'publishing needs a date');

  await db.user(editor, `update posts set status = 'scheduled', published_at = now() + interval '1 day' where id = $1`, [postId]);
  assert.equal((await db.anon('select * from public_posts')).length, 0, 'scheduled in the future: hidden');
  await db.sql(`update posts set published_at = now() - interval '1 minute' where id = $1`, [postId]);
  assert.equal((await db.anon('select * from public_posts')).length, 1, 'scheduled time reached: live');

  await db.user(editor, `update posts set status = 'published' where id = $1`, [postId]);
  await assert.rejects(db.user(editor, `update posts set slug = 'new-slug' where id = $1`, [postId]), /slug_locked/);
  await assert.rejects(db.user(editor, `update blog_categories set slug = 'money' where id = $1`, [budget]), /slug_locked/);
  await db.user(editor, `update blog_categories set name = 'Money & budgets' where id = $1`, [budget]);   // renaming is fine
});

test('comments: held for moderation, emails never public, spam controls', async () => {
  const r = await comment(c());
  assert.equal(r.status, 'pending');
  assert.equal((await db.anon('select * from public_comments')).length, 0, 'pending comments are hidden');
  await assert.rejects(db.anon('select * from comments'), /permission denied/);

  await assert.rejects(comment(c({ email: 'nope' })), /invalid_email/);
  await assert.rejects(comment(c({ name: ' ' })), /name_required/);
  await assert.rejects(comment(c({ body: 'x' })), /invalid_body/);
  await assert.rejects(comment(c({ body: 'see http://a.com http://b.com www.c.com' })), /too_many_links/);
  await assert.rejects(comment(c({ post_id: '00000000-0000-0000-0000-000000000000' })), /comments_closed/);

  const bot = await comment(c({ website: 'http://spam.example' }));
  assert.equal(bot.status, 'pending', 'bots are told "pending"…');
  assert.equal((await db.one('select status from comments where id = $1', [bot.id])).status, 'spam', '…but it goes straight to spam');

  for (let i = 0; i < 3; i++) await comment(c({ email: 'chatty@x.com' }));
  await assert.rejects(comment(c({ email: 'CHATTY@x.com' })), /rate_limited/);

  await db.user(editor, `update posts set comments_open = false where id = $1`, [postId]);
  await assert.rejects(comment(c()), /comments_closed/);
  await db.user(editor, `update posts set comments_open = true where id = $1`, [postId]);
});

test('moderation: bulk approve/reject/spam, admin reply is live and staff-marked, replies stay one level deep', async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await comment(c({ body: `Question number ${i}?` }))).id);
  await assert.rejects(db.user(editor, 'select admin_moderate_comments($1::uuid[], $2)', [ids, 'approved']), /forbidden/);
  await assert.rejects(db.user(vendor, 'select admin_moderate_comments($1::uuid[], $2)', [ids, 'approved']), /forbidden/);
  const n = (await db.user(admin, 'select admin_moderate_comments($1::uuid[], $2) as n', [ids.slice(0, 2), 'approved']))[0].n;
  assert.equal(n, 2);
  await db.user(admin, 'select admin_moderate_comments($1::uuid[], $2)', [[ids[2]], 'rejected']);
  const pub = await db.anon('select * from public_comments where post_id = $1', [postId]);
  assert.equal(pub.length, 2);
  assert.ok(!('author_email' in pub[0]), 'no emails in public data');

  const replyId = (await db.user(admin, 'select admin_reply_comment($1, $2) as id', [ids[0], 'Great question, prices start around $4k.']))[0].id;
  const reply = await db.one('select parent_id, status, is_staff from comments where id = $1', [replyId]);
  assert.deepEqual({ ...reply }, { parent_id: ids[0], status: 'approved', is_staff: true });

  const nested = await comment(c({ parent_id: replyId, body: 'Thanks so much!' }));
  assert.equal((await db.one('select parent_id from comments where id = $1', [nested.id])).parent_id, ids[0], 'reply-to-reply is flattened to one level');

  const stats = (await db.user(admin, 'select admin_stats(14) as s'))[0].s;
  assert.ok(stats.attention.pending_comments >= 1);
});

test('blog category delete: blocked while it has posts, allowed after moving them', async () => {
  await assert.rejects(db.user(editor, 'select editor_delete_blog_category($1)', [budget]), /category_has_posts/);
  await db.user(editor, 'select editor_delete_blog_category($1, $2)', [budget, venues]);
  assert.equal((await db.one('select category_id from posts where id = $1', [postId])).category_id, venues);
  assert.equal((await db.sql('select 1 from blog_categories where id = $1', [budget])).length, 0);
  await assert.rejects(db.user(vendor, 'select editor_delete_blog_category($1)', [venues]), /forbidden/);
});

test('vendor categories: hide, slug lock, no delete while used; hidden ones refused for leads', async () => {
  const cat = await catId(db, 'photo-booths');
  const austin = await cityId(db, 'Austin');
  await makeVendor(db, { name: 'Snap Booth', category: 'photo-booths' });
  await assert.rejects(db.user(admin, `update categories set slug = 'booths' where id = $1`, [cat]), /slug_locked/);
  await assert.rejects(db.user(admin, 'delete from categories where id = $1', [cat]), /category_in_use/);
  await db.user(admin, `update categories set active = false, name = 'Photo booth rentals' where id = $1`, [cat]);
  await assert.rejects(db.anon('select submit_lead($1::jsonb)', [JSON.stringify(lead({ city_id: austin, category_ids: [cat] }))]), /invalid_categories/);
  await db.user(admin, `insert into categories (slug, name, singular, sort) values ('mehndi', 'Mehndi artists', 'Mehndi artist', 160)`);
  await db.user(admin, `update categories set slug = 'mehndi-henna' where slug = 'mehndi'`);   // unused: slug can change
  await db.user(admin, `delete from categories where slug = 'mehndi-henna'`);
});

test('roles: admin can make an editor; editors cannot reach admin tools; vendor plan guard still holds', async () => {
  await assert.rejects(db.user(editor, 'select admin_set_role($1, $2)', ['v@x.test', 'admin']), /forbidden/);
  await db.user(admin, 'select admin_set_role($1, $2)', ['v@x.test', 'editor']);
  assert.equal((await db.one('select role from profiles where id = $1', [vendor])).role, 'editor');
  await assert.rejects(db.user(admin, 'select admin_set_role($1, $2)', ['admin@bloomvow.test', 'vendor']), /cannot_demote_self/);
  await assert.rejects(db.user(editor, 'select admin_stats(14)'), /forbidden/);
  await db.user(admin, 'select admin_set_role($1, $2)', ['v@x.test', 'vendor']);

  const owner = await makeUser(db, 'own@x.test');
  const v = await makeVendor(db, { name: 'Guarded', owner_id: owner, status: 'claimed' });
  await assert.rejects(db.user(owner, `update vendors set plan = 'featured' where id = $1`, [v.id]), /permission denied/);
  await db.user(admin, `update vendors set description = 'Fixed by admin', plan = 'featured' where id = $1`, [v.id]);
  assert.equal((await db.one('select plan from vendors where id = $1', [v.id])).plan, 'featured');
  const l = (await db.anon('select submit_lead($1::jsonb) as r', [JSON.stringify(lead({ source: 'profile', vendor_id: v.id, city_id: await cityId(db, 'Austin') }))]))[0].r;
  await db.user(admin, 'select admin_mark_spam($1)', [l.lead_id]);
  assert.equal((await db.one('select status from leads where id = $1', [l.lead_id])).status, 'spam');
});

test('per-country categories: hide a category in one country only', async () => {
  const officiants = await catId(db, 'officiants');
  const austin = await cityId(db, 'Austin');
  await assert.rejects(db.user(vendor, `insert into country_hidden_categories values ('in', $1)`, [officiants]), /row-level security/);
  await db.user(admin, `insert into country_hidden_categories values ('in', $1)`, [officiants]);
  assert.equal((await db.anon('select * from country_hidden_categories')).length, 1, 'public site can read it');
  // US is unaffected:
  await db.anon('select submit_lead($1::jsonb)', [JSON.stringify(lead({ city_id: austin, category_ids: [officiants] }))]);
  // An Indian city can't request it:
  const [mh] = await db.sql(`select id from regions where country_code = 'in' and code = 'ka'`);
  const [blr] = await db.sql(`insert into cities (region_id, name, slug) values ($1, 'Bengaluru', 'bengaluru') returning id`, [mh.id]);
  await assert.rejects(db.anon('select submit_lead($1::jsonb)', [JSON.stringify(lead({ city_id: blr.id, category_ids: [officiants] }))]), /category_unavailable/);
});
