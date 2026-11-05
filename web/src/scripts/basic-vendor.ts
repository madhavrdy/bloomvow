// Fills the shared /vendor/?v=<slug> page for basic (not pre-built) listings.
import { initVendorPage } from './vendor-page';

const meta = () => document.querySelector<HTMLMetaElement>('meta[name="bv-api"]')!;
async function get<T>(path: string): Promise<T[]> {
  const m = meta();
  const res = await fetch(`${m.content}/rest/v1/${path}`, { headers: { apikey: m.dataset.key!, authorization: `Bearer ${m.dataset.key}` } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
const $ = (id: string) => document.getElementById(id)!;

export async function initBasicVendor() {
  const slug = new URLSearchParams(location.search).get('v') ?? '';
  try {
    const [v] = slug ? await get<Record<string, any>>(`public_vendors?slug=eq.${encodeURIComponent(slug)}&select=*`) : [];
    if (!v) throw new Error('missing');
    // A full profile exists for this vendor now (it was claimed or filled in): go there.
    const full = `/vendor/${v.slug}/`;
    if (v.status === 'claimed' || v.description) {
      const head = await fetch(full, { method: 'HEAD' }).catch(() => null);
      if (head?.ok) { location.replace(full); return; }
    }
    const [[city], [cat]] = await Promise.all([
      get<Record<string, any>>(`cities?id=eq.${v.city_id}&select=id,name,slug,regions(code,slug,country_code)`),
      get<Record<string, any>>(`categories?id=eq.${v.category_id}&select=slug,name,singular`),
    ]);
    const st = String(city.regions.code).toUpperCase();
    document.title = `${v.name}: ${cat.singular} in ${city.name}, ${st}`;
    $('bv-name').textContent = v.name;
    $('bv-meta').textContent = `${cat.singular} · ${city.name}, ${st}`;
    const listing = $('bv-listing') as HTMLAnchorElement;
    listing.href = `/${city.regions.country_code}/${city.regions.slug}/${city.slug}/${cat.slug}/`;
    listing.textContent = `${city.name} ${cat.name.toLowerCase()}`;
    if (v.phone) { const a = $('bv-phone') as HTMLAnchorElement; a.href = `tel:${v.phone.replace(/[^\d+]/g, '')}`; a.textContent = `Call ${v.phone}`; a.hidden = false; }
    if (v.website && /^https?:\/\//i.test(v.website)) { const a = $('bv-web') as HTMLAnchorElement; a.href = v.website; a.hidden = false; }
    if (v.address) {
      const a = $('bv-dir') as HTMLAnchorElement;
      a.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.name} ${v.address} ${city.name} ${st}`)}`; a.hidden = false;
      $('bv-address').textContent = `${v.address}, ${city.name}, ${st} ${v.zip ?? ''}`;
    }
    ($('bv-claim') as HTMLAnchorElement).href = `/for-vendors/?claim=${v.id}`;
    const form = $('lead-form') as HTMLFormElement;
    form.dataset.vendor = v.id; form.dataset.city = String(v.city_id);
    $('basic-vendor').dataset.vendorPage = v.id;
    $('bv-loading').hidden = true; $('bv-page').hidden = false;
    initVendorPage();
    loadNearby(v.id, city.name, cat, listing.href).catch(() => {});
  } catch {
    $('bv-loading').hidden = true; $('bv-missing').hidden = false;
  }
}

type Near = { id: string; slug: string; name: string; category_id: number; city: string; st: string; km: number; rating: number | null;
  review_count: number; price_from: number | null; photo: string | null; has_page: boolean };
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export function nearCard(v: Near, i: number, catName?: string): string {
  const url = v.has_page ? `/vendor/${v.slug}/` : `/vendor/?v=${v.slug}`;
  return `<a href="${url}" class="vcard">${v.photo ? `<img src="${esc(v.photo)}" alt="${esc(v.name)}" loading="lazy" width="400" height="180">` : `<div class="ph ph-${i % 5}"></div>`}
  <div class="vcard-body">${catName ? `<span class="vcard-cat">${esc(catName)}</span>` : ''}<b>${esc(v.name)}</b>
  <span class="muted">${esc(v.city)}, ${esc(v.st)}${v.km > 0 ? ` · ${Math.round(v.km * 0.621)} mi away` : ''}</span>
  ${v.rating ? `<span><b style="font-size:14px">★ ${Number(v.rating).toFixed(1)}</b> <span class="muted">(${v.review_count} reviews)</span></span>` : ''}
  ${v.price_from != null ? `<span style="color:var(--green);font-weight:600">From ${usd(v.price_from)}</span>` : ''}</div></a>`;
}
async function loadNearby(id: string, cityName: string, cat: Record<string, any>, listingUrl: string) {
  const m = meta();
  const res = await fetch(`${m.content}/rest/v1/rpc/nearby_vendors`, { method: 'POST',
    headers: { apikey: m.dataset.key!, authorization: `Bearer ${m.dataset.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_vendor: id, p_limit: 6 }) });
  if (!res.ok) return;
  const r: { same: Near[]; team: Near[] } = await res.json();
  if (r.same.length) {
    $('bv-nearby-h').textContent = `More ${String(cat.name).toLowerCase()} near ${cityName}`;
    $('bv-nearby-sub').textContent = `Popular with couples in and around ${cityName}.`;
    $('bv-nearby').querySelector('.card-grid')!.innerHTML = r.same.map((v, i) => nearCard(v, i + 1)).join('');
    const all = $('bv-nearby-all') as HTMLAnchorElement; all.href = listingUrl; all.textContent = `See all ${String(cat.name).toLowerCase()} in ${cityName} →`;
    $('bv-nearby').hidden = false;
  }
  if (r.team.length) {
    const cats = await get<{ id: number; singular: string }>(`categories?select=id,singular&id=in.(${[...new Set(r.team.map((t) => t.category_id))].join(',')})`);
    const name = new Map(cats.map((c) => [c.id, c.singular]));
    $('bv-team-h').textContent = `Complete your wedding team in ${cityName}`;
    $('bv-team').querySelector('.card-grid')!.innerHTML = r.team.map((v, i) => nearCard(v, i + 1, name.get(v.category_id))).join('');
    $('bv-team').hidden = false;
  }
}
