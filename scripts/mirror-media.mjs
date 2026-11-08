#!/usr/bin/env node
// Copies photos kept in Supabase Storage onto the site itself, so visitors load them from
// celebrateio.com (Hostinger and its CDN) instead of Supabase. Supabase then serves each
// photo once per build, not once per visitor, which keeps us well inside the free plan.
//
// Runs after `astro build`: finds every public Storage URL in the built pages and data files
// (blog covers, photos inside posts, vendor photos, category and page images), downloads each
// file once into a cache folder kept between builds, copies it to dist/media/<bucket>/<path>
// and points the pages at <site>/media/<bucket>/<path>. A photo that can't be fetched keeps
// its Supabase address, so nothing ever breaks.
//
// Usage: node scripts/mirror-media.mjs <dist> [--cache .media-cache] [--site https://celebrateio.com]
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--')) ?? 'web/dist');
const cacheDir = path.resolve(opt('cache', '.media-cache'));
const site = (opt('site', process.env.SITE_URL || '') || '').replace(/\/+$/, '');

// <origin>/storage/v1/object/public/<bucket>/<path>; only plain file names (our uploads are
// UUIDs), no query strings, image types only.
const URL_RE = /(https?:\/\/[a-z0-9.:-]+)\/storage\/v1\/object\/public\/([a-z0-9_-]+)\/([A-Za-z0-9_\/.-]+?\.(?:jpe?g|png|webp|gif|avif))(?![A-Za-z0-9_\/.?-])/gi;
const TEXT = /\.(html|xml|json|txt|webmanifest)$/i;
const MAX_BYTES = 15 * 1024 * 1024;

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else if (TEXT.test(e.name)) yield p;
  }
}

async function exists(p) { try { return (await fs.stat(p)).size > 0; } catch { return false; } }

async function fetchFile(url, dest) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.status === 404 || res.status === 400) return 'missing';
      if (!res.ok) throw new Error(String(res.status));
      if (!/^image\//.test(res.headers.get('content-type') ?? '')) return 'not an image';
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) return 'bad size';
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest + '.part', buf);
      await fs.rename(dest + '.part', dest);
      return 'ok';
    } catch (e) {
      if (attempt === 3) return `failed (${e.message})`;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const t0 = Date.now();
// 1. Find every Storage URL in the built files.
const files = [];
const found = new Map();                       // full url -> { bucket, rel }
for await (const f of walk(dist)) {
  const text = await fs.readFile(f, 'utf8');
  if (!text.includes('/storage/v1/object/public/')) continue;
  files.push(f);
  for (const m of text.matchAll(URL_RE)) {
    if (m[3].split('/').some((s) => s === '..' || s === '.' || !s)) continue;
    found.set(m[0], { bucket: m[2], rel: m[3] });
  }
}

// 2. Download what the cache doesn't have yet.
let downloaded = 0, cached = 0;
const failed = [];
const ok = new Set();
await pool([...found], 8, async ([url, { bucket, rel }]) => {
  const c = path.join(cacheDir, bucket, rel);
  if (await exists(c)) { cached++; ok.add(url); return; }
  const r = await fetchFile(url, c);
  if (r === 'ok') { downloaded++; ok.add(url); } else failed.push(`${url} — ${r}`);
});

// 3. Copy into dist/media and point the pages at the copies.
for (const url of ok) {
  const { bucket, rel } = found.get(url);
  const out = path.join(dist, 'media', bucket, rel);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.copyFile(path.join(cacheDir, bucket, rel), out);
}
let rewritten = 0;
for (const f of files) {
  const text = await fs.readFile(f, 'utf8');
  const next = text.replace(URL_RE, (u, _o, bucket, rel) => (ok.has(u) ? `${site}/media/${bucket}/${rel}` : u));
  if (next !== text) { await fs.writeFile(f, next); rewritten++; }
}

console.log(`Photos: ${found.size} found, ${cached} from cache, ${downloaded} downloaded, ${failed.length} kept on Supabase; ${rewritten} files updated (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
for (const f of failed.slice(0, 20)) console.log(`::warning::Photo not copied, still served from Supabase: ${f}`);
