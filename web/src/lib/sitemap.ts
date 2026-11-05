import { getData } from './data';
import { PAGE_SIZE } from './constants';

// Only indexable pages go in the sitemap: thin city x category pages
// (fewer than min_vendors_to_index vendors) are left out and marked noindex.
export async function allUrls() {
  const d = await getData();
  const urls: { loc: string; lastmod?: string }[] = [{ loc: '/' }, { loc: '/categories/' }, { loc: '/get-matched/' }, { loc: '/for-vendors/' }];
  for (const c of d.countries) urls.push({ loc: d.urls.country(c) });
  for (const r of d.regions) if (d.activeCities.some((c) => c.region_id === r.id)) urls.push({ loc: d.urls.region(r) });
  for (const c of d.categories) urls.push({ loc: `/categories/${c.slug}/` });
  for (const c of d.activeCities) if ((d.listingsByCity.get(c.id) ?? []).some((l) => l.indexable)) urls.push({ loc: d.urls.city(c) });
  for (const l of d.listings) {
    if (!l.indexable) continue;
    const last = l.vendors.reduce((m, v) => (v.updated_at > m ? v.updated_at : m), '');
    urls.push({ loc: l.url, lastmod: last.slice(0, 10) });
    for (let p = 2; p <= Math.ceil(l.vendors.length / PAGE_SIZE); p++) urls.push({ loc: `${l.url}page/${p}/` });
  }
  urls.push({ loc: '/blog/', lastmod: d.posts[0]?.updated_at.slice(0, 10) });
  for (const c of d.blogCategories) urls.push({ loc: d.urls.blogCategory(c) });
  for (const p of d.posts) urls.push({ loc: d.urls.post(p), lastmod: p.updated_at.slice(0, 10) });
  for (const [name] of d.postsByAuthor) urls.push({ loc: d.urls.author(name) });
  for (const x of d.styleListings) urls.push({ loc: x.url, lastmod: x.vendors.reduce((m, v) => (v.updated_at > m ? v.updated_at : m), '').slice(0, 10) });
  for (const v of d.vendors.filter(d.vendorIndexable)) urls.push({ loc: d.urls.vendor(v), lastmod: v.updated_at.slice(0, 10) });

  return urls;
}

export const SITEMAP_CHUNK = 45000;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
export async function chunks() {
  const urls = await allUrls();
  return Array.from({ length: Math.max(1, Math.ceil(urls.length / SITEMAP_CHUNK)) }, (_, i) => urls.slice(i * SITEMAP_CHUNK, (i + 1) * SITEMAP_CHUNK));
}
export const urlset = (site: URL | undefined, urls: { loc: string; lastmod?: string }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `<url><loc>${esc(new URL(u.loc, site).href)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
