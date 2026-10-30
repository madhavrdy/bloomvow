type Index = { cities: { n: string; u: string; c: string[] }[]; states: { n: string; k: string; u: string }[] };
let index: Promise<Index> | null = null;
const load = (): Promise<Index> => (index ??= fetch('/data/search.json').then((r) => r.json() as Promise<Index>));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Resolve what the visitor typed to the best page on the site.
export function resolveSearch(idx: Index, where: string, category: string): string | null {
  const q = norm(where);
  if (!q) return null;
  const exact = idx.cities.find((c) => norm(c.n) === q) ?? idx.cities.find((c) => norm(c.n.split(',')[0]) === q);
  const city = exact ?? idx.cities.find((c) => norm(c.n).startsWith(q));
  if (city) return city.c.includes(category) ? `${city.u}${category}/` : city.u;
  const state = idx.states.find((s) => norm(s.n) === q || norm(s.k) === q);
  return state ? state.u : null;
}

export function initSearch() {
  const form = document.getElementById('search') as HTMLFormElement | null;
  if (!form) return;
  const where = form.querySelector<HTMLInputElement>('#search-where')!;
  const list = document.getElementById('city-list')!;
  const err = document.getElementById('search-error')!;
  where.addEventListener('focus', async () => {
    if (list.childElementCount) return;
    const idx = await load();
    list.innerHTML = '';
    for (const c of [...idx.cities.map((x) => x.n), ...idx.states.map((x) => x.n)]) {
      const o = document.createElement('option'); o.value = c; list.appendChild(o);
    }
  }, { once: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cat = (form.querySelector('#search-cat') as HTMLSelectElement).value;
    const url = resolveSearch(await load(), where.value, cat);
    if (url) location.href = url;
    else err.textContent = `We don't list vendors in "${where.value}" yet. Try a nearby city, or get matched and we'll find vendors for you.`;
  });
}
