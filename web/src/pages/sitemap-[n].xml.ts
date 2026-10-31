import type { APIContext } from 'astro';
import { chunks, urlset } from '../lib/sitemap';

export async function getStaticPaths() {
  return (await chunks()).map((_, i) => ({ params: { n: String(i + 1) } }));
}
export async function GET({ site, params }: APIContext) {
  const part = (await chunks())[Number(params.n) - 1];
  return new Response(urlset(site, part), { headers: { 'content-type': 'application/xml' } });
}
