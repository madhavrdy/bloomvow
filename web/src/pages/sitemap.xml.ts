import type { APIContext } from 'astro';
import { chunks, blogUrls } from '../lib/sitemap';

// Sitemap index: /sitemap-1.xml, /sitemap-2.xml... (directory pages, 45,000 URLs each, under
// Google's 50,000 limit) and /sitemap-blog.xml (blog). Only indexable pages are listed.
export async function GET({ site }: APIContext) {
  const parts = await chunks();
  const today = new Date().toISOString().slice(0, 10);
  const blogDate = (await blogUrls())[0]?.lastmod ?? today;
  const files = [...parts.map((_, i) => ({ loc: `/sitemap-${i + 1}.xml`, lastmod: today })), { loc: '/sitemap-blog.xml', lastmod: blogDate }];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files
    .map((f) => `<sitemap><loc>${new URL(f.loc, site).href}</loc><lastmod>${f.lastmod}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml' } });
}
