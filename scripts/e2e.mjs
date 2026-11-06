// Full end-to-end run: fresh database -> local Supabase gateway -> site build
// -> preview server -> browser tests.
// Usage: POSTGREST_BIN=/path/postgrest AUTH_BIN=/path/auth node scripts/e2e.mjs
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ANON_KEY } from './local-keys.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const DB = 'bv_e2e';
const GATEWAY = 54341, REST = 54342, SITE = 4329;
if (!process.env.AUTH_BIN || !process.env.POSTGREST_BIN) { console.error('Set POSTGREST_BIN and AUTH_BIN (see README).'); process.exit(1); }
const env = { ...process.env, DEV_DB: DB, GATEWAY_PORT: String(GATEWAY), REST_PORT: String(REST), SITE_URL: `http://localhost:${SITE}` };
const kids = [];
const stop = () => kids.forEach((k) => { try { k.kill(); } catch {} });
process.on('exit', stop);

const waitFor = async (url, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
};

console.log('1/5 database');
execFileSync('node', ['db/scripts/reset.mjs'], { cwd: root, env, stdio: 'inherit' });

// Test tracking IDs, so the built pages carry the tags (browser tests block the real hosts).
const pg = (await import('pg')).default;
const c = new pg.Client({ host: '/tmp', port: 54329, user: 'postgres', database: DB });
await c.connect();
await c.query(`update settings set value = $1 where key = 'tracking'`, [JSON.stringify({ ga4: 'G-TEST12345', google_ads: 'AW-111222333', google_ads_lead_label: 'LeadLabel1', meta_pixel: '1234567890', gsc: 'gsc-test-token-123' })]);
await c.end();

console.log('2/5 api gateway');
kids.push(spawn('node', ['scripts/local-stack.mjs'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] }));
await waitFor(`http://localhost:${GATEWAY}/rest/v1/`);
await waitFor(`http://localhost:${GATEWAY}/auth/v1/health`);

console.log('3/5 build');
const siteEnv = { ...process.env, SITE_URL: `http://localhost:${SITE}`, PUBLIC_SUPABASE_URL: `http://localhost:${GATEWAY}`, PUBLIC_SUPABASE_ANON_KEY: ANON_KEY, PUBLIC_SITE_NAME: 'Bloomvow' };
fs.rmSync(path.join(web, 'dist'), { recursive: true, force: true });
execFileSync('npx', ['astro', 'build', '--silent'], { cwd: web, env: siteEnv, stdio: 'inherit' });

console.log('4/5 preview server');
kids.push(spawn('npx', ['astro', 'preview', '--port', String(SITE)], { cwd: web, env: siteEnv, stdio: 'ignore' }));
await waitFor(`http://localhost:${SITE}/`);

console.log('5/5 browser tests');
const only = process.argv[2];
const files = fs.readdirSync(path.join(web, 'tests')).filter((f) => f.endsWith('.e2e.mjs') && (!only || f.includes(only))).map((f) => path.join('tests', f));
const test = spawn('node', ['--test', '--test-concurrency=1', '--test-reporter=spec', ...files], {
  cwd: web, stdio: 'inherit',
  env: { ...process.env, SITE: `http://localhost:${SITE}`, API: `http://localhost:${GATEWAY}`, DB, PGHOST: '/tmp', PGPORT: '54329', DIST: path.join(web, 'dist') },
});
const code = await new Promise((r) => test.on('exit', r));
stop();
process.exit(code);
