// Rebuild the local development database: Supabase shim + migrations + sample data.
// Usage: npm run db:reset            (database name: bv_dev)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshDb } from '../test/helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const name = process.env.DEV_DB || 'bv_dev';
execFileSync('node', [path.join(here, '../seed/generate-sample.mjs')], { stdio: 'inherit' });
// With AUTH_BIN set, the real Supabase auth schema is installed too (needed for logins).
const db = await freshDb(name, { seed: [path.join(here, '../seed/sample_data.sql')], realAuth: Boolean(process.env.AUTH_BIN) });
const counts = await db.one(`select (select count(*) from vendors) vendors, (select count(*) from leads) leads,
  (select count(*) from reviews) reviews, (select count(*) from events) events`);
console.log(`database ${name} ready:`, counts);
await db.close();
