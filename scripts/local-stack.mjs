// Runs a local stand-in for Supabase, on the same URLs supabase-js uses:
//   /rest/v1/*     -> PostgREST
//   /auth/v1/*     -> Supabase auth server (GoTrue), when AUTH_BIN is set
//   /storage/v1/*  -> a small file store that applies the same permission check
//                     as our storage policies (can_edit_vendor_path)
// Usage: POSTGREST_BIN=... AUTH_BIN=... node scripts/local-stack.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { JWT_SECRET, ANON_KEY, SERVICE_KEY } from './local-keys.mjs';
import { authEnv } from '../db/test/helpers.mjs';

const PORT = Number(process.env.GATEWAY_PORT || 54321);
const REST_PORT = Number(process.env.REST_PORT || 54331);
const AUTH_PORT = Number(process.env.AUTH_PORT || REST_PORT + 100);
const SITE_URL = process.env.SITE_URL || 'http://localhost:4321';
const db = process.env.DEV_DB || 'bv_dev';
const files = path.join(os.tmpdir(), `bv-storage-${db}`);
fs.mkdirSync(files, { recursive: true });

const kids = [];
const stopAll = () => { kids.forEach((k) => k.kill()); process.exit(0); };
process.on('SIGTERM', stopAll);
process.on('SIGINT', stopAll);

const conf = path.join(os.tmpdir(), `postgrest-${db}.conf`);
fs.writeFileSync(conf, [
  `db-uri = "postgres://authenticator:local-dev-only@%2Ftmp:54329/${db}"`,
  'db-schemas = "public"', 'db-anon-role = "anon"', `jwt-secret = "${JWT_SECRET}"`,
  `server-port = ${REST_PORT}`, 'db-max-rows = 1000', 'log-level = "error"',
].join('\n'));
const rest = spawn(process.env.POSTGREST_BIN || 'postgrest', [conf], { stdio: ['ignore', 'inherit', 'inherit'] });
rest.on('exit', (c) => { console.error(`postgrest exited (${c})`); process.exit(1); });
kids.push(rest);

if (process.env.AUTH_BIN) {
  const auth = spawn(process.env.AUTH_BIN, ['serve'], {
    cwd: path.dirname(process.env.AUTH_BIN), stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...authEnv(db, { jwtSecret: JWT_SECRET, port: AUTH_PORT, external: `http://localhost:${PORT}/auth/v1`, site: SITE_URL }) },
  });
  auth.on('exit', (c) => { console.error(`auth server exited (${c})`); process.exit(1); });
  kids.push(auth);
}

const pool = new pg.Pool({ host: '/tmp', port: 54329, user: 'postgres', database: db, max: 3 });
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, prefer, range, x-client-info, accept-profile, content-profile, x-upsert, cache-control, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, x-total-count',
};

function proxy(req, res, port, strip) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url.slice(strip.length) || '/', headers }, (u) => {
    res.writeHead(u.statusCode, { ...u.headers, ...cors });
    u.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, cors); res.end(String(e)); });
  req.pipe(up);
}

function verifyJwt(token) {
  const [h, b, s] = (token || '').split('.');
  if (!s) return null;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  if (sig !== s) return null;
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  return claims.exp && claims.exp * 1000 < Date.now() ? null : claims;
}

async function canEdit(claims, name, bucket = 'vendor-photos') {
  if (!claims || claims.role === 'anon') return false;
  if (claims.role === 'service_role') return true;
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const r = bucket === 'blog-images' ? await c.query('select public.is_editor() ok')
      : bucket === 'ad-images' ? await c.query('select public.is_admin() ok')
      : await c.query('select can_edit_vendor_path($1) ok', [name]);
    await c.query('commit');
    return r.rows[0].ok;
  } catch { await c.query('rollback'); return false; } finally { c.release(); }
}

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
const safe = (p) => !p.split('/').some((x) => x === '..' || x === '');

async function storage(req, res) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.replace(/^\/storage\/v1\/object\//, '');
  const claims = verifyJwt((req.headers.authorization || '').replace(/^Bearer /, '') || req.headers.apikey);

  if (req.method === 'GET' && parts.startsWith('public/')) {
    const rel = decodeURIComponent(parts.slice(7));
    const f = path.join(files, rel);
    if (!safe(rel) || !fs.existsSync(f)) return send(res, 404, { error: 'not_found' });
    const type = (fs.readFileSync(`${f}.type`, 'utf8') || 'application/octet-stream');
    res.writeHead(200, { 'content-type': type, ...cors });
    return fs.createReadStream(f).pipe(res);
  }
  if ((req.method === 'POST' || req.method === 'PUT') && parts.length) {
    const rel = decodeURIComponent(parts);
    const [bucket, ...rest] = rel.split('/');
    const name = rest.join('/');
    if (!['vendor-photos', 'blog-images', 'ad-images'].includes(bucket) || !safe(rel)) return send(res, 400, { error: 'invalid_path' });
    if (!(await canEdit(claims, name, bucket))) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    let body = Buffer.concat(chunks);
    let type = req.headers['content-type'] || 'application/octet-stream';
    // supabase-js sends File/Blob uploads as multipart/form-data: pull out the file part.
    const m = /^multipart\/form-data;\s*boundary=(.+)$/i.exec(type);
    if (m) {
      const boundary = Buffer.from(`--${m[1].replace(/^"|"$/g, '')}`);
      let pos = body.indexOf(boundary);
      let file = null;
      while (pos !== -1) {
        const next = body.indexOf(boundary, pos + boundary.length);
        if (next === -1) break;
        const part = body.subarray(pos + boundary.length + 2, next - 2);
        const split = part.indexOf('\r\n\r\n');
        const head = part.subarray(0, split).toString();
        if (/content-type:/i.test(head) || /filename=/i.test(head)) {
          file = { body: part.subarray(split + 4), type: (/content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? 'application/octet-stream').trim() };
        }
        pos = next;
      }
      if (!file) return send(res, 400, { error: 'no_file' });
      body = file.body; type = file.type;
    }
    if (body.length > 5 * 1024 * 1024) return send(res, 413, { error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return send(res, 415, { error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
    fs.mkdirSync(path.dirname(path.join(files, rel)), { recursive: true });
    fs.writeFileSync(path.join(files, rel), body);
    fs.writeFileSync(path.join(files, rel) + '.type', type);
    await pool.query('insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', [bucket, name, claims.sub ?? null]);
    return send(res, 200, { Key: rel, Id: crypto.randomUUID() });
  }
  if (req.method === 'DELETE') {
    const bucket = parts.split('/')[0];
    let body = '';
    for await (const ch of req) body += ch;
    const prefixes = JSON.parse(body || '{}').prefixes || [];
    const removed = [];
    for (const name of prefixes) {
      if (!safe(name) || !(await canEdit(claims, name))) continue;
      fs.rmSync(path.join(files, bucket, name), { force: true });
      fs.rmSync(path.join(files, bucket, name) + '.type', { force: true });
      await pool.query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, name]);
      removed.push({ name });
    }
    return send(res, 200, removed);
  }
  return send(res, 404, { error: 'not_found' });
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.url.startsWith('/rest/v1')) return proxy(req, res, REST_PORT, '/rest/v1');
  if (req.url.startsWith('/auth/v1') && process.env.AUTH_BIN) return proxy(req, res, AUTH_PORT, '/auth/v1');
  if (req.url.startsWith('/storage/v1/object')) return storage(req, res).catch((e) => send(res, 500, { error: String(e) }));
  res.writeHead(404, cors); res.end('not found');
}).listen(PORT, () => {
  console.log(`local supabase gateway on http://localhost:${PORT}`);
  console.log(`anon key:    ${ANON_KEY}`);
  console.log(`service key: ${SERVICE_KEY}`);
});
