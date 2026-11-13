import type { APIContext } from 'astro';
import { PREVIEW } from '../config';
import { getData } from '../lib/data';
import { finalRobots } from '../lib/robots';

// robots.txt: the custom version from Admin > SEO files, or the built-in default (lib/robots.ts).
export async function GET({ site }: APIContext) {
  if (PREVIEW) return new Response('# Preview site: not for search engines\nUser-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
  const d = await getData();
  return new Response(finalRobots(d.robotsTxt, String(site)), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
