import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.mjs';

let db;
before(async () => { db = await freshDb('bv_test_bootstrap'); });
after(() => db?.close());

test('owner email becomes admin only after confirming; other emails stay vendors', async () => {
  const [u] = await db.sql(`insert into auth.users (id, email) values (gen_random_uuid(), 'MadhavRDD25@gmail.com') returning id`);
  assert.equal((await db.one('select role from profiles where id = $1', [u.id])).role, 'vendor', 'unconfirmed: no admin');
  await db.sql('update auth.users set email_confirmed_at = now() where id = $1', [u.id]);
  assert.equal((await db.one('select role from profiles where id = $1', [u.id])).role, 'admin');
  const [o] = await db.sql(`insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'someone@x.test', now()) returning id`);
  assert.equal((await db.one('select role from profiles where id = $1', [o.id])).role, 'vendor');
});
