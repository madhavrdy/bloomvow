import type { APIContext } from 'astro';
import { chunks } from '../lib/sitemap';

// Sitemap index: points to /sitemap-1.xml, /sitemap-2.xml... (45,000 URLs each,
// under Google's 50,000 limit). Only indexable pages are listed.
export async function GET({ site }: APIContext) {
  const parts = await chunks();
  const today = new Date().toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts
    .map((_, i) => `<sitemap><loc>${new URL(`/sitemap-${i + 1}.xml`, site).href}</loc><lastmod>${today}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml' } });
}
