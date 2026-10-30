import type { APIContext } from 'astro';

export function GET({ site }: APIContext) {
  return new Response(
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /vendor-dashboard/\nDisallow: /shortlist/\n\nSitemap: ${new URL('/sitemap.xml', site).href}\n`,
    { headers: { 'content-type': 'text/plain' } });
}
