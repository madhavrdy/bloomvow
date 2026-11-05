// Header search: suggests pages (cities, categories, "venues in Austin"...) as you type,
// plus vendors by name from the database. Enter opens the top suggestion, or /search/.
import { rpc } from './api';

export type Entry = { t: string; u: string; k: string; w: number };
export type VendorHit = { slug: string; name: string; city: string; st: string; cat: string };
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
// Common words people type that aren't in page titles.
const ALIASES: Record<string, string> = { venue: 'venues', photographer: 'photographers', photography: 'photographers', makeup: 'hair makeup',
  hair: 'hair makeup', mua: 'hair makeup', dj: 'djs', band: 'bands', cake: 'cakes', bakery: 'cakes', caterer: 'caterers', catering: 'caterers',
  florist: 'florists', flowers: 'florists', planner: 'planners', limo: 'transportation', nyc: 'new york city', la: 'los angeles', sf: 'san francisco' };

// Every word typed must start a word in the title (any order); bigger pages rank higher.
export function matchPages(index: Entry[], q: string, n = 6): Entry[] {
  const words = norm(q).split(' ').filter(Boolean).flatMap((w) => norm(ALIASES[w] ?? w).split(' '))
    .filter((w) => !['in', 'near', 'the', 'a', 'for', 'wedding', 'weddings'].includes(w));
  if (!words.length) return [];
  return index
    .map((e) => ({ e, title: norm(e.t).split(' ') }))
    .filter(({ title }) => words.every((w) => title.some((t) => t.startsWith(w))))
    .sort((a, b) => b.e.w - a.e.w || a.e.t.length - b.e.t.length)
    .slice(0, n).map((x) => x.e);
}

let index: Promise<Entry[]> | null = null;
export const loadIndex = () => (index ??= fetch('/data/site-search.json').then((r) => r.json() as Promise<Entry[]>));
export const findVendors = (q: string, n = 5) => (q.trim().length < 2 ? Promise.resolve([] as VendorHit[]) : rpc<VendorHit[]>('search_vendor_names', { p_q: q, p_limit: n }));
const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export function initSiteSearch() {
  const form = document.getElementById('hsearch') as HTMLFormElement | null;
  if (!form) return;
  const input = form.querySelector<HTMLInputElement>('input[name=q]')!;
  const box = document.getElementById('hsearch-list')!;
  const toggle = document.getElementById('hsearch-toggle');
  let items: { url: string; html: string }[] = [];
  let active = -1;
  let seq = 0;
  let timer: number | undefined;

  const render = () => {
    box.innerHTML = items.map((it, i) => `<li role="option" id="hs-${i}" aria-selected="${i === active}">${it.html}</li>`).join('');
    box.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(!box.hidden));
    if (active >= 0) input.setAttribute('aria-activedescendant', `hs-${active}`); else input.removeAttribute('aria-activedescendant');
  };
  const update = async () => {
    const q = input.value; const my = ++seq;
    const pages = matchPages(await loadIndex(), q);
    const show = (vendors: VendorHit[]) => {
      if (my !== seq) return;
      items = [
        ...pages.map((p) => ({ url: p.u, html: `<a href="${p.u}"><span class="hs-k">${esc(p.k)}</span>${esc(p.t)}</a>` })),
        ...vendors.map((v) => ({ url: `/vendor/${v.slug}/`, html: `<a href="/vendor/${esc(v.slug)}/"><span class="hs-k">${esc(v.cat)}</span>${esc(v.name)} <span class="muted">· ${esc(v.city)}, ${esc(v.st)}</span></a>` })),
      ];
      if (q.trim()) items.push({ url: `/search/?q=${encodeURIComponent(q.trim())}`, html: `<a href="/search/?q=${encodeURIComponent(q.trim())}" class="hs-all">See all results for “${esc(q.trim())}”</a>` });
      active = -1; render();
    };
    show([]);
    findVendors(q).then(show).catch(() => {});
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(update, 150); });
  input.addEventListener('focus', () => { loadIndex(); if (input.value) update(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render();
    } else if (e.key === 'Escape') { items = []; render(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim(); if (!q) return;
    location.href = active >= 0 ? items[active].url : items.length > 1 ? items[0].url : `/search/?q=${encodeURIComponent(q)}`;
  });
  document.addEventListener('click', (e) => { if (!form.contains(e.target as Node) && e.target !== toggle) { items = []; render(); } });
  toggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('search-open');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  });
}
