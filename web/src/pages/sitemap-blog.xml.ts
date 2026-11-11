import type { APIContext } from 'astro';
import { blogUrls, urlset } from '../lib/sitemap';

// Blog sitemap: blog home, categories, posts and author pages (listed in /sitemap.xml).
export async function GET({ site }: APIContext) {
  return new Response(urlset(site, await blogUrls()), { headers: { 'content-type': 'application/xml' } });
}
