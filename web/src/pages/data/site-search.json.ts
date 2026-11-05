import { getData } from '../../lib/data';

// Compact list of every browsable page for the header search (loaded on first focus).
// t = title, u = url, k = kind, w = weight (vendor count) for ranking.
export async function GET() {
  const d = await getData();
  const out: { t: string; u: string; k: string; w: number }[] = [];
  for (const l of d.listings) out.push({ t: `${l.category.name} in ${l.city.name}, ${l.region.code.toUpperCase()}`, u: l.url, k: 'Listing', w: l.vendors.length });
  for (const x of d.styleListings) out.push({ t: `${x.style.label} ${x.listing.category.name.toLowerCase()} in ${x.listing.city.name}`, u: x.url, k: 'Venue style', w: x.vendors.length });
  for (const c of d.activeCities) out.push({ t: `${c.name}, ${d.regionById.get(c.region_id)!.code.toUpperCase()}`, u: d.urls.city(c), k: 'City', w: d.cityVendorCount(c) + 1000 });
  for (const r of d.regions) if (d.activeCities.some((c) => c.region_id === r.id)) out.push({ t: r.name, u: d.urls.region(r), k: 'State', w: 500 });
  for (const c of d.categories) out.push({ t: c.name, u: `/categories/${c.slug}/`, k: 'Category', w: 2000 });
  for (const p of d.posts) out.push({ t: p.title, u: d.urls.post(p), k: 'Article', w: 1 });
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
}
