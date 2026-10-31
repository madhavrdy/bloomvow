// Vendor website enricher: reads a CSV with a `website` column (for example the
// vendors.csv from the Overture import, or your own list) and visits each
// vendor's own website to fill in public business facts:
//   phone, email, address, ZIP, starting price, guest capacity, and a short
//   site summary (kept in its own column for you to review, never imported as-is).
//
// Rules it follows:
//   * obeys robots.txt (User-agent * and BloomvowBot), identifies itself, waits
//     between requests to the same site, max 4 pages per site;
//   * never copies reviews, testimonials or photos;
//   * plain fetch (no browser), so sites that only render with JavaScript give less.
//
// Usage:
//   node scripts/scraper/enrich.mjs vendors.csv enriched.csv [--concurrency 6] [--delay 1500]
// Then import enriched.csv in Admin > Vendors > Import CSV (duplicates merge, nothing is overwritten).
import fs from 'node:fs';

export const UA = 'BloomvowBot/1.0 (wedding vendor directory; contact via website)';
const PAGES = ['', 'contact', 'contact-us', 'pricing', 'about'];

// ------------------------------------------------------------------ CSV
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
export function toCsv(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

// ------------------------------------------------------------ robots.txt
export function robotsAllows(txt, path, agent = 'bloomvowbot') {
  const groups = []; let cur = null;
  for (const raw of (txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...v] = line.split(':'); const key = k.trim().toLowerCase(); const val = v.join(':').trim();
    if (key === 'user-agent') { if (!cur || cur.rules.length) groups.push(cur = { agents: [], rules: [] }); cur.agents.push(val.toLowerCase()); }
    else if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const rx = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (rx.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// ------------------------------------------------------------ extraction
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
// Remove parts of a page that hold other people's words or media.
const stripNoise = (html) => html
  .replace(/<(script|style|noscript|svg|iframe)(?![^>]*application\/ld\+json)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<([a-z]+)[^>]*(class|id)="[^"]*(review|testimonial|quote|instagram|feed)[^"]*"[\s\S]*?<\/\1>/gi, ' ');
const text = (html) => decode(stripNoise(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]); const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { out.push(x); if (x['@graph']) walk(x['@graph']); } }; walk(j); } catch { /* bad JSON-LD */ }
  }
  return out;
}
const US_PHONE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/i;
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|@(sentry|wixpress|example|domain|email)\.|^(noreply|no-reply|donotreply)@/i;

export function extract(html, pageUrl) {
  const r = {};
  const ld = jsonLd(html).filter((x) => x.address || x.telephone || x.email || x.priceRange);
  const biz = ld[0];
  if (biz) {
    if (biz.telephone) r.phone = String(biz.telephone);
    if (biz.email) r.email = String(biz.email).replace(/^mailto:/, '');
    const a = Array.isArray(biz.address) ? biz.address[0] : biz.address;
    if (a && typeof a === 'object') { if (a.streetAddress) r.address = String(a.streetAddress); if (a.postalCode) r.zip = String(a.postalCode).slice(0, 10); }
  }
  const tel = html.match(/href="tel:([^"]+)"/i);
  if (!r.phone && tel) r.phone = decodeURIComponent(tel[1]).trim();
  const mail = [...html.matchAll(/href="mailto:([^"?]+)/gi)].map((m) => decodeURIComponent(m[1]).trim()).find((e) => EMAIL.test(e) && !BAD_EMAIL.test(e));
  const t = text(html);
  if (!r.email) r.email = mail ?? (t.match(new RegExp(EMAIL.source, 'gi')) ?? []).find((e) => !BAD_EMAIL.test(e));
  if (!r.phone) { const m = t.match(US_PHONE); if (m) r.phone = `(${m[1]}) ${m[2]}-${m[3]}`; }
  // Price hints: "starting at $4,500", "packages from $2,000", "$1,800+".
  const price = t.match(/(?:start(?:s|ing)?(?: at| from)?|from|packages? (?:start )?(?:at|from))\s*\$\s?(\d{1,3}(?:,\d{3})+|\d{3,6})/i);
  if (price) { const n = Number(price[1].replace(/,/g, '')); if (n >= 50 && n <= 500000) r.price_from = n; }
  const cap = t.match(/(?:up to|max(?:imum)?(?: of)?|accommodat\w* up to|seat\w* up to)\s*(\d{2,4})\s*(?:guests|people|persons|seated)/i);
  if (cap) { const n = Number(cap[1]); if (n >= 10 && n <= 3000) r.capacity = n; }
  const meta = html.match(/<meta[^>]+name="description"[^>]+content="([^"]{30,400})"/i) ?? html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]{30,400})"/i);
  if (meta) r.site_summary = decode(meta[1]).trim();
  const site = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]{2,80})"/i);
  if (site) r.site_name = decode(site[1]).trim();
  if (r.email && !EMAIL.test(r.email)) delete r.email;
  r.source_url = pageUrl;
  return r;
}

// ------------------------------------------------------------ crawling
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, timeout = 12000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,text/plain' }, redirect: 'follow', signal: ac.signal });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/text\/(html|plain)/.test(type)) return { status: res.status, body: '' };
    return { status: res.status, body: (await res.text()).slice(0, 1_500_000), url: res.url };
  } catch (e) { return { status: 0, body: '', error: e.name }; } finally { clearTimeout(t); }
}

export async function enrichSite(website, { delay = 1500 } = {}) {
  let base;
  try { base = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`); } catch { return { enrich_status: 'bad url' }; }
  const robots = await get(new URL('/robots.txt', base).href);
  const robotsTxt = robots.status === 200 ? robots.body : '';
  const found = {}; let pages = 0;
  for (const p of PAGES) {
    const u = new URL(p ? `/${p}` : base.pathname || '/', base);
    if (!robotsAllows(robotsTxt, u.pathname)) { if (!p) return { enrich_status: 'blocked by robots.txt' }; continue; }
    if (pages) await sleep(delay);
    const r = await get(u.href); pages++;
    if (!r.body) { if (!p) return { enrich_status: r.status ? `http ${r.status}` : 'unreachable' }; continue; }
    for (const [k, v] of Object.entries(extract(r.body, r.url ?? u.href))) if (v != null && found[k] == null) found[k] = v;
    if (found.phone && found.email && found.address && found.price_from) break;
  }
  return { ...found, enrich_status: 'ok', pages };
}

export async function enrichRows(rows, { concurrency = 6, delay = 1500, log = () => {} } = {}) {
  const out = new Array(rows.length); let next = 0, done = 0;
  async function worker() {
    for (let i = next++; i < rows.length; i = next++) {
      const row = rows[i];
      if (!row.website) { out[i] = { ...row, enrich_status: 'no website' }; continue; }
      const e = await enrichSite(row.website, { delay });
      const { source_url, site_name, ...facts } = e;
      // Fill blanks only; never overwrite what the row already has.
      const merged = { ...row };
      for (const [k, v] of Object.entries(facts)) if (v != null && v !== '' && !merged[k]) merged[k] = v;
      out[i] = merged; done++;
      if (done % 25 === 0) log(`${done}/${rows.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return out;
}

// ------------------------------------------------------------------ CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [inFile, outFile = 'enriched.csv'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
  if (!inFile) { console.error('Usage: node scripts/scraper/enrich.mjs vendors.csv enriched.csv [--concurrency 6] [--delay 1500]'); process.exit(1); }
  const rows = parseCsv(fs.readFileSync(inFile, 'utf8'));
  const out = await enrichRows(rows, { concurrency: opt('concurrency', 6), delay: opt('delay', 1500), log: console.log });
  fs.writeFileSync(outFile, toCsv(out));
  const ok = out.filter((r) => r.enrich_status === 'ok');
  console.log(`Done: ${ok.length}/${out.length} sites read; emails ${out.filter((r) => r.email).length}, prices ${out.filter((r) => r.price_from).length}. Wrote ${outFile}`);
}
