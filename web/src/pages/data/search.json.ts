import { getData } from '../../lib/data';

// Small static index for the homepage search box (loaded on first focus).
export async function GET() {
  const d = await getData();
  const cities = d.activeCities.map((c) => {
    const r = d.regionById.get(c.region_id)!;
    return { n: `${c.name}, ${r.code.toUpperCase()}`, u: d.urls.city(c), c: (d.listingsByCity.get(c.id) ?? []).map((l) => l.category.slug) };
  });
  const states = d.regions
    .filter((r) => d.activeCities.some((c) => c.region_id === r.id))
    .map((r) => ({ n: r.name, k: r.code.toUpperCase(), u: d.urls.region(r) }));
  return new Response(JSON.stringify({ cities, states }), { headers: { 'content-type': 'application/json' } });
}
