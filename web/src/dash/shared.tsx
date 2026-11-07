import { useEffect, useState } from 'preact/hooks';
import { sb, must } from './supabase';

export type Category = { id: number; slug: string; name: string; singular: string; uses_capacity: boolean; sort: number; budget_share: number };
export type City = { id: number; name: string; slug: string; region_id: number; label: string; region_slug: string; country_code: string };
export type Ref = { categories: Category[]; cities: City[]; cityById: Map<number, City>; catById: Map<number, Category>; bands: number[] };

// Load every row of a table/view, 1000 at a time (Supabase's default page limit).
export async function loadAll<T>(table: string, select: string, order = 'id'): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = await must<T[]>(sb().from(table).select(select).order(order).range(from, from + 999) as never);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

let refCache: Promise<Ref> | null = null;
export function loadRef(): Promise<Ref> {
  refCache ??= (async () => {
    const [categories, regions, citiesRaw, settings] = await Promise.all([
      loadAll<Category & { active: boolean }>('categories', 'id,slug,name,singular,uses_capacity,sort,budget_share,active', 'sort'),
      loadAll<{ id: number; code: string; slug: string; country_code: string }>('regions', 'id,code,slug,country_code'),
      loadAll<{ id: number; name: string; slug: string; region_id: number }>('cities', 'id,name,slug,region_id', 'name'),
      loadAll<{ key: string; value: unknown }>('settings', 'key,value', 'key'),
    ]);
    const reg = new Map(regions.map((r) => [r.id, r]));
    const cities = citiesRaw.map((c) => {
      const r = reg.get(c.region_id)!;
      return { ...c, label: `${c.name}, ${r.code.toUpperCase()}`, region_slug: r.slug, country_code: r.country_code };
    });
    const bands = (settings.find((s) => s.key === 'budget_bands')?.value as number[]) ?? [15000, 30000, 50000, 80000, 150000];
    return { categories, cities, cityById: new Map(cities.map((c) => [c.id, c])), catById: new Map(categories.map((c) => [c.id, c])), bands };
  })();
  return refCache;
}

export function useRef_(): Ref | null {
  const [ref, setRef] = useState<Ref | null>(null);
  useEffect(() => { loadRef().then(setRef); }, []);
  return ref;
}

export const fmtMoney = (n: number | null | undefined) => (n == null ? '–' : `$${new Intl.NumberFormat('en-US').format(n)}`);
export const fmtNum = (n: number | null | undefined) => (n == null ? '–' : new Intl.NumberFormat('en-US').format(n));
export const fmtDate = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '–');
export function ago(s: string): string {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
export const replyTime = (mins: number | null | undefined) =>
  mins == null ? '–' : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.round(mins / 1440)} days`;

export function bandLabel(bands: number[], b: number | null): string {
  if (b == null) return 'Not given';
  const f = (n: number) => `$${Math.round(n / 1000)}k`;
  return b === 0 ? `Under ${f(bands[0])}` : b === bands.length - 1 ? `${f(bands[b - 1])}+` : `${f(bands[b - 1])}–${f(bands[b])}`;
}

export function Toast({ text }: { text: string }) {
  return text ? <div class="toast" role="status">{text}</div> : null;
}

export function useToast(): [string, (t: string) => void] {
  const [t, setT] = useState('');
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(''), 3500); return () => clearTimeout(id); }, [t]);
  return [t, setT];
}

// Simple hash router: #leads, #listing ...
export function useHash(defaultRoute: string): [string, (r: string) => void] {
  const read = () => location.hash.replace(/^#/, '') || defaultRoute;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const f = () => setRoute(read());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  // On phones the menu is a sideways-scrolling row: keep the current section in view.
  useEffect(() => {
    const t = setTimeout(() => document.querySelector('.side a[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }), 50);
    return () => clearTimeout(t);
  }, [route]);
  return [route, (r) => { location.hash = r; }];
}
