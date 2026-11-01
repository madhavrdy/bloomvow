import { rpc } from './api';

const STEP = 20;

// Pure filter logic (unit-tested): does a vendor row match the chosen filters?
export type Filters = { guests: number; prices: [number, number][]; settings: string[]; minRating: number };
export type RowData = { cap: number | null; price: number | null; setting: string; rating: number };
export function matches(r: RowData, f: Filters): boolean {
  if (f.guests && r.cap != null && r.cap < f.guests) return false;
  if (f.prices.length && (r.price == null || !f.prices.some(([lo, hi]) => r.price! >= lo && (hi === 0 || r.price! < hi)))) return false;
  if (f.settings.length && !f.settings.includes(r.setting)) return false;
  if (f.minRating && r.rating < f.minRating) return false;
  return true;
}

const num = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s));

// ---------------------------------------------------------- URL <-> filters
// Filters live in the query string (?guests=100&price=0-4000&setting=Outdoor&rating=4.5&sort=price)
// so a filtered view can be shared. The canonical URL stays the plain page.
const KEYS = ['guests', 'price', 'setting', 'rating', 'sort'];
export function filtersToQuery(fd: FormData, sort: string): string {
  const q = new URLSearchParams();
  const g = fd.get('guests'); if (g && g !== '0') q.set('guests', String(g));
  for (const p of fd.getAll('price')) q.append('price', String(p));
  for (const st of fd.getAll('setting')) q.append('setting', String(st));
  if (fd.get('rating')) q.set('rating', String(fd.get('rating')));
  if (sort && sort !== 'rec') q.set('sort', sort);
  return q.toString();
}
export function queryToSearch(q: URLSearchParams) {
  return {
    guests: Number(q.get('guests') ?? 0) || null,
    prices: q.getAll('price').map((p) => p.split('-').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)),
    settings: q.getAll('setting'),
    min_rating: q.get('rating') ? Number(q.get('rating')) : null,
    sort: q.get('sort') ?? 'rec',
  };
}

// --------------------------------------------- rows rendered from the API
type Row = { id: string; slug: string; name: string; city: string; st: string; setting: string | null; capacity_max: number | null; price_from: number | null;
  rating: number | null; review_count: number; featured: boolean; description: string | null; photo: string | null; has_page: boolean };
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export function rowHtml(v: Row, i: number, usesCapacity: boolean): string {
  const url = v.has_page ? `/vendor/${v.slug}/` : `/vendor/?v=${v.slug}`;
  return `<div class="item db-item"><article class="vrow" data-vendor="${esc(v.id)}">
  <a href="${url}" class="vrow-media ${v.photo ? '' : `ph ph-${i % 5}`}" aria-label="${esc(v.name)} photos">${v.photo ? `<img src="${esc(v.photo)}" alt="${esc(v.name)}" loading="lazy" decoding="async" width="480" height="320">` : ''}${v.featured ? '<span class="badge badge-white">Featured</span>' : ''}</a>
  <div class="vrow-body"><div class="vrow-top"><h3 style="margin:0"><a href="${url}" class="vrow-name">${esc(v.name)}</a></h3>${v.rating ? `<span style="font-size:14px"><b>★ ${Number(v.rating).toFixed(1)}</b> <span class="muted">(${v.review_count})</span></span>` : ''}</div>
  <span class="muted" style="font-size:14px">${esc(v.city)}, ${esc(v.st)}${v.setting ? ` · ${esc(v.setting)}` : ''}</span>
  <div class="vrow-facts">${usesCapacity && v.capacity_max ? `<span>Up to <b>${v.capacity_max}</b> guests</span>` : ''}${v.price_from != null ? `<span>From <b>${usd(v.price_from)}</b></span>` : ''}</div>
  ${v.description ? `<p>${esc(v.description)}</p>` : ''}
  <div class="vrow-actions"><a href="${url}#lead" class="btn btn-primary">Request pricing</a><a href="${url}" class="btn btn-outline">View profile</a></div></div></article></div>`;
}

export function initListing() {
  const form = document.getElementById('filters') as HTMLFormElement | null;
  const list = document.getElementById('list');
  if (!form || !list) return;
  const items = [...list.querySelectorAll<HTMLElement>('.item')];
  const count = document.getElementById('count')!;
  const empty = document.getElementById('empty')!;
  const more = document.getElementById('more') as HTMLButtonElement | null;
  const pager = document.querySelector<HTMLElement>('.pager');
  const sortSel = document.getElementById('sort') as HTMLSelectElement | null;
  const total = Number(list.dataset.total ?? items.length);
  // Every vendor is already on the page: filter in the browser. Otherwise ask the database.
  const complete = total <= items.length;
  const usesCapacity = !!form.querySelector('[name=guests]');
  let shown = STEP;
  let dbOffset = 0;
  let dbMode = false;

  const read = (): Filters => {
    const fd = new FormData(form);
    return {
      guests: Number(fd.get('guests') ?? 0),
      prices: fd.getAll('price').map((p) => String(p).split('-').map(Number) as [number, number]),
      settings: fd.getAll('setting').map(String),
      minRating: fd.get('rating') ? Number(fd.get('rating')) : 0,
    };
  };
  const sortVal = () => sortSel?.value ?? 'rec';
  const active = () => filtersToQuery(new FormData(form), sortVal()) !== '';

  const applyLocal = () => {
    const f = read();
    const ok = items.filter((el) => matches({ cap: num(el.dataset.cap), price: num(el.dataset.price), setting: el.dataset.setting ?? '', rating: Number(el.dataset.rating) }, f));
    items.forEach((el) => (el.hidden = true));
    ok.slice(0, shown).forEach((el) => (el.hidden = false));
    count.textContent = String(ok.length);
    empty.hidden = ok.length > 0;
    if (more) more.hidden = ok.length <= shown;
  };

  async function loadDb(reset: boolean) {
    if (reset) { dbOffset = 0; list!.querySelectorAll('.db-item').forEach((el) => el.remove()); }
    items.forEach((el) => (el.hidden = true));
    if (pager) pager.hidden = true;
    const p = { ...queryToSearch(new URLSearchParams(filtersToQuery(new FormData(form!), sortVal()))),
      style: (new FormData(form!).get('style') as string) || null, offset: dbOffset, limit: STEP };
    list!.setAttribute('aria-busy', 'true');
    try {
      const r = await rpc<{ total: number; rows: Row[] }>('search_vendors', { p_city: Number(list!.dataset.city), p_category: Number(list!.dataset.cat), p });
      list!.insertAdjacentHTML('beforeend', r.rows.map((v, i) => rowHtml(v, dbOffset + i, usesCapacity)).join(''));
      dbOffset += r.rows.length;
      count.textContent = String(r.total);
      empty.hidden = r.total > 0;
      if (more) more.hidden = dbOffset >= r.total;
    } catch {
      empty.hidden = false;
    } finally { list!.removeAttribute('aria-busy'); }
  }

  const update = () => {
    const q = filtersToQuery(new FormData(form), sortVal());
    history.replaceState(null, '', q ? `?${q}` : location.pathname);
    shown = STEP;
    dbMode = !complete && active();
    if (dbMode) return loadDb(true);
    list.querySelectorAll('.db-item').forEach((el) => el.remove());
    if (pager) pager.hidden = false;
    sortLocal();
    applyLocal();
  };

  const sortLocal = () => {
    const by = sortVal();
    const key = (el: HTMLElement) => ({
      rec: Number(el.dataset.i),
      rating: -Number(el.dataset.rating),
      price: num(el.dataset.price) ?? Number.MAX_SAFE_INTEGER,
      reviews: -Number(el.dataset.reviews),
    } as Record<string, number>)[by];
    items.sort((a, b) => key(a) - key(b) || Number(a.dataset.i) - Number(b.dataset.i)).forEach((el) => list.appendChild(el));
  };

  // Restore filters from the URL.
  const q = new URLSearchParams(location.search);
  if (KEYS.some((k) => q.has(k))) {
    for (const el of form.querySelectorAll<HTMLInputElement>('input[name]')) {
      if (el.type === 'hidden') continue;
      const vals = q.getAll(el.name);
      if (el.type === 'radio') el.checked = vals.length ? vals.includes(el.value) : el.value === '0';
      else if (el.type === 'checkbox') el.checked = vals.includes(el.value);
    }
    if (sortSel && q.get('sort')) sortSel.value = q.get('sort')!;
    update();
  }

  form.addEventListener('change', update);
  form.addEventListener('reset', () => setTimeout(update));
  document.getElementById('clear2')?.addEventListener('click', () => form.reset());
  more?.addEventListener('click', () => { if (dbMode) loadDb(false); else { shown += STEP; applyLocal(); } });
  sortSel?.addEventListener('change', update);

  // One batched impression event for the vendors visible on load.
  const ids = items.slice(0, STEP).map((el) => el.querySelector<HTMLElement>('[data-vendor]')?.dataset.vendor).filter(Boolean);
  if (ids.length) rpc('track_impressions', { p_vendors: ids, p_path: location.pathname }).catch(() => {});
}
