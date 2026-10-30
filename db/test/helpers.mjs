// Test helpers: build a fresh database from the migrations and run queries
// as a specific Supabase role/user, the same way PostgREST does.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const conn = {
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 54329),
  user: process.env.PGUSER || 'postgres',
};

// Settings for the local Supabase auth server (GoTrue).
export function authEnv(dbName, { jwtSecret = '', port = 9999, external = '', site = '' } = {}) {
  return {
    GOTRUE_DB_DRIVER: 'postgres',
    DATABASE_URL: `postgres://supabase_auth_admin:local-dev-only@localhost:${conn.port}/${dbName}?search_path=auth&sslmode=disable`,
    API_EXTERNAL_URL: external || `http://localhost:${port}`,
    GOTRUE_API_HOST: '127.0.0.1',
    PORT: String(port),
    GOTRUE_SITE_URL: site || 'http://localhost:4321',
    GOTRUE_URI_ALLOW_LIST: '*',
    GOTRUE_JWT_SECRET: jwtSecret || 'unused-for-migrations-0123456789abcdef',
    GOTRUE_JWT_EXP: '3600',
    GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_DISABLE_SIGNUP: 'false',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_MAILER_AUTOCONFIRM: 'true',   // local only: no confirmation emails
    GOTRUE_LOG_LEVEL: 'error',
  };
}

export function migrationFiles() {
  const dir = path.join(root, 'migrations');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(dir, f));
}

// realAuth: install Supabase's real auth schema (GoTrue migrations) first, so the
// local auth server can run against this database. Needs AUTH_BIN (the auth binary).
export async function freshDb(name, { seed = [], realAuth = false } = {}) {
  const admin = new pg.Client({ ...conn, database: 'postgres' });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const client = new pg.Client({ ...conn, database: name });
  await client.connect();
  if (realAuth) {
    await client.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
        create role supabase_auth_admin login createrole password 'local-dev-only';
      end if; end $$;
      create schema auth authorization supabase_auth_admin;`);
    const bin = process.env.AUTH_BIN;
    if (!bin) throw new Error('AUTH_BIN must point to the Supabase auth binary');
    execFileSync(bin, ['migrate'], {
      cwd: path.dirname(bin), stdio: 'ignore',
      env: { ...process.env, ...authEnv(name), GOTRUE_DB_MIGRATIONS_PATH: path.join(path.dirname(bin), 'migrations') },
    });
  }
  const files = [path.join(here, 'supabase_shim.sql'), ...migrationFiles(), ...seed];
  for (const f of files) await client.query(fs.readFileSync(f, 'utf8'));
  return new Db(client);
}

export class Db {
  constructor(client) { this.client = client; }

  // Run SQL as a role. role: 'postgres' | 'anon' | 'authenticated' | 'service_role'
  async as(role, uid, sql, params = []) {
    const c = this.client;
    await c.query('begin');
    try {
      if (role !== 'postgres') {
        await c.query(`set local role ${role}`);
        await c.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [uid || '', role]);
      }
      const res = await c.query(sql, params);
      await c.query('commit');
      return res.rows;
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
  }
  sql(sql, params) { return this.as('postgres', null, sql, params); }
  anon(sql, params) { return this.as('anon', null, sql, params); }
  user(uid, sql, params) { return this.as('authenticated', uid, sql, params); }
  async one(...a) { return (await this.sql(...a))[0]; }
  close() { return this.client.end(); }
}

export async function cityId(db, name) {
  return (await db.one('select id from cities where name = $1', [name])).id;
}
export async function catId(db, slug) {
  return (await db.one('select id from categories where slug = $1', [slug])).id;
}

export async function makeUser(db, email, role = 'vendor') {
  const u = await db.one('insert into auth.users (email) values ($1) returning id', [email]);
  if (role !== 'vendor') await db.sql('update profiles set role = $2 where id = $1', [u.id, role]);
  return u.id;
}

let n = 0;
export async function makeVendor(db, o) {
  n += 1;
  const row = await db.one(
    `insert into vendors (slug, name, category_id, city_id, email, phone, website, price_from, capacity_max,
                          status, plan, owner_id, rating, review_count)
     values ($1, $2, (select id from categories where slug = $3), (select id from cities where name = $4),
             $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning *`,
    [o.slug || `v-${n}`, o.name || `Vendor ${n}`, o.category || 'wedding-venues', o.city || 'Austin',
     o.email === undefined ? `v${n}@example.com` : o.email, o.phone || null, o.website || null,
     o.price_from ?? null, o.capacity_max ?? null, o.status || 'unclaimed', o.plan || 'free',
     o.owner_id || null, o.rating ?? null, o.review_count ?? 0]);
  return row;
}

export function lead(overrides = {}) {
  return {
    source: 'matched', couple_name: 'Jordan & Priya', email: `couple${Math.random().toString(36).slice(2, 8)}@example.com`,
    guests: 150, budget_band: 2, message: 'Hi!', ...overrides,
  };
}
