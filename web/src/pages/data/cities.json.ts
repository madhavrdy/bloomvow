import { getData } from '../../lib/data';

// Every city in the active markets (used by the Get matched flow), including
// cities with no vendors yet: those leads are kept for the team to route.
export async function GET() {
  const d = await getData();
  const list = d.cities.map((c) => {
    const r = d.regionById.get(c.region_id)!;
    return { id: c.id, name: `${c.name}, ${r.code.toUpperCase()}`, url: d.listingsByCity.has(c.id) ? d.urls.city(c) : '/' };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json' } });
}
