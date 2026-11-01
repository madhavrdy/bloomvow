import { getData } from '../../lib/data';

// Every page the content editor can customise (Admin > Page content).
export async function GET() {
  const d = await getData();
  const out: { path: string; title: string; type: string; vendors: number; indexable: boolean }[] = [];
  for (const r of d.regions) {
    const cities = d.activeCities.filter((c) => c.region_id === r.id);
    if (cities.length) out.push({ path: d.urls.region(r), title: `Wedding vendors in ${r.name}`, type: 'State', vendors: cities.reduce((n, c) => n + d.cityVendorCount(c), 0), indexable: true });
  }
  for (const c of d.activeCities) {
    const r = d.regionById.get(c.region_id)!;
    out.push({ path: d.urls.city(c), title: `Wedding vendors in ${c.name}, ${r.code.toUpperCase()}`, type: 'City', vendors: d.cityVendorCount(c), indexable: (d.listingsByCity.get(c.id) ?? []).some((l) => l.indexable) });
  }
  for (const c of d.categories) out.push({ path: `/categories/${c.slug}/`, title: `${c.name} near you`, type: 'Category', vendors: (d.listingsByCategory.get(c.id) ?? []).reduce((n, l) => n + l.vendors.length, 0), indexable: true });
  for (const l of d.listings) out.push({ path: l.url, title: `${l.category.name} in ${l.city.name}, ${l.region.code.toUpperCase()}`, type: 'City + category', vendors: l.vendors.length, indexable: l.indexable });
  for (const x of d.styleListings) out.push({ path: x.url, title: `${x.style.label} ${x.listing.category.name.toLowerCase()} in ${x.listing.city.name}`, type: 'Style', vendors: x.vendors.length, indexable: true });
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
}
