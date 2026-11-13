import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser } from './helpers.mjs';

let db, admin, editor;
before(async () => { db = await freshDb('bv_test_robots'); admin = await makeUser(db, 'a@site.test', 'admin'); editor = await makeUser(db, 'e@site.test', 'editor'); });
after(() => db?.close());
const set = (who, v) => db.user(who, `update settings set value = $1 where key = 'robots_txt' returning key`, [JSON.stringify(v)]);

test('robots.txt setting: admins only, valid directives only', async () => {
  assert.equal((await db.one(`select value from settings where key = 'robots_txt'`)).value, '', 'starts as default');
  assert.equal((await set(admin, '# custom\nUser-agent: *\nDisallow: /tmp/\n\nSitemap: https://celebrateio.com/sitemap.xml')).length, 1);
  assert.equal((await set(editor, 'User-agent: *\nDisallow: /')).length, 0, 'editors cannot change it');
  await assert.rejects(set(admin, 'User-agent: *\n<script>alert(1)</script>'), /settings_robots_check/);
  await assert.rejects(set(admin, 'Sitemap: /relative.xml'), /settings_robots_check/);
  await assert.rejects(set(admin, 'x'.repeat(10001)), /settings_robots_check/);
  await assert.rejects(set(admin, { not: 'text' }), /settings_robots_check/);
  await set(admin, '');
});
