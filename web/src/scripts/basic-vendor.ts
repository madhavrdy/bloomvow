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
  } catch {
    $('bv-loading').hidden = true; $('bv-missing').hidden = false;
  }
}
