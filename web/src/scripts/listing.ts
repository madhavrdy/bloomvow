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

export function initListing() {
  const form = document.getElementById('filters') as HTMLFormElement | null;
  const list = document.getElementById('list');
  if (!form || !list) return;
  const items = [...list.querySelectorAll<HTMLElement>('.item')];
  const count = document.getElementById('count')!;
  const empty = document.getElementById('empty')!;
  const more = document.getElementById('more');
  let shown = STEP;

  const read = (): Filters => {
    const fd = new FormData(form);
    return {
      guests: Number(fd.get('guests') ?? 0),
      prices: fd.getAll('price').map((p) => String(p).split('-').map(Number) as [number, number]),
      settings: fd.getAll('setting').map(String),
      minRating: fd.get('rating') ? Number(fd.get('rating')) : 0,
    };
  };

  const apply = () => {
    const f = read();
    const ok = items.filter((el) => matches({ cap: num(el.dataset.cap), price: num(el.dataset.price), setting: el.dataset.setting ?? '', rating: Number(el.dataset.rating) }, f));
    items.forEach((el) => (el.hidden = true));
    ok.slice(0, shown).forEach((el) => (el.hidden = false));
    count.textContent = String(ok.length);
    empty.hidden = ok.length > 0;
    if (more) more.hidden = ok.length <= shown;
  };

  form.addEventListener('change', () => { shown = STEP; apply(); });
  form.addEventListener('reset', () => setTimeout(() => { shown = STEP; apply(); }));
  document.getElementById('clear2')?.addEventListener('click', () => form.reset());
  more?.addEventListener('click', () => { shown += STEP; apply(); });

  document.getElementById('sort')?.addEventListener('change', (e) => {
    const by = (e.target as HTMLSelectElement).value;
    const key = (el: HTMLElement) => ({
      rec: Number(el.dataset.i),
      rating: -Number(el.dataset.rating),
      price: num(el.dataset.price) ?? Number.MAX_SAFE_INTEGER,
      reviews: -Number(el.dataset.reviews),
    } as Record<string, number>)[by];
    items.sort((a, b) => key(a) - key(b) || Number(a.dataset.i) - Number(b.dataset.i)).forEach((el) => list.appendChild(el));
    apply();
  });

  // One batched impression event for the vendors visible on load.
  const ids = items.slice(0, STEP).map((el) => el.querySelector<HTMLElement>('[data-vendor]')?.dataset.vendor).filter(Boolean);
  if (ids.length) rpc('track_impressions', { p_vendors: ids, p_path: location.pathname }).catch(() => {});
}
