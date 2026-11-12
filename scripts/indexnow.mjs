// Tells Bing, Yandex and other IndexNow search engines which pages changed.
// Usage (after a deploy): SITE_URL=https://www.yourdomain.com node scripts/indexnow.mjs web/dist
// The key is the public file web/public/<key>.txt (public by design).
import fs from 'node:fs';
import path from 'node:path';

const dist = process.argv[2] || 'web/dist';
const site = (process.env.SITE_URL || '').replace(/\/$/, '');
if (!/^https:\/\//.test(site) || /example\.com/.test(site)) { console.log('IndexNow: SITE_URL not set to the live domain, skipping'); process.exit(0); }
const keyFile = fs.readdirSync(path.join(path.dirname(dist), 'public')).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
const key = keyFile.replace('.txt', '');
// URLs from the sitemap chunks whose lastmod is within the last 2 days (or every URL with --all).
const since = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
const all = process.argv.includes('--all');
const urls = fs.readdirSync(dist).filter((f) => /^sitemap-(\d+|blog)\.xml$/.test(f))
  .flatMap((f) => [...fs.readFileSync(path.join(dist, f), 'utf8').matchAll(/<loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)])
  .filter((m) => all || (m[2] && m[2] >= since)).map((m) => m[1]).slice(0, 10000);
if (!urls.length) { console.log('IndexNow: nothing changed'); process.exit(0); }
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(site).host, key, keyLocation: `${site}/${key}.txt`, urlList: urls }),
});
console.log(`IndexNow: sent ${urls.length} URLs, status ${res.status}`);
