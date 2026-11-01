import type { APIContext } from 'astro';
import { getData } from '../lib/data';
import { SITE_NAME, TAGLINE, CONTACT_EMAIL } from '../config';

// /llms.txt: a plain-text map of the site for AI assistants (llmstxt.org format).
export async function GET({ site }: APIContext) {
  const d = await getData();
  const u = (p: string) => new URL(p, site).href;
  const top = [...d.listings].filter((l) => l.indexable).sort((a, b) => b.vendors.length - a.vendors.length).slice(0, 40);
  const lines = [
    `# ${SITE_NAME}`, '',
    `> ${TAGLINE} across the United States. ${d.vendors.length.toLocaleString('en-US')} wedding vendors in ${d.activeCities.length} cities: venues, photographers, hair & makeup, caterers, cakes, florists and more. Couples can compare starting prices and request quotes for free.`, '',
    'Listing pages show each city and vendor category with factual "At a glance" summaries (counts, starting-price ranges, capacity) built from the listings themselves. Ratings come only from reviews submitted and checked on this site.', '',
    '## Vendor categories', ...d.categories.map((c) => `- [${c.name}](${u(`/categories/${c.slug}/`)})`), '',
    '## Popular city pages', ...top.map((l) => `- [${l.category.name} in ${l.city.name}, ${l.region.code.toUpperCase()}](${u(l.url)}): ${l.vendors.length} vendors`), '',
    '## Planning guides', `- [Wedding planning blog](${u('/blog/')})`, ...d.posts.slice(0, 20).map((p) => `- [${p.title}](${u(d.urls.post(p))})`), '',
    '## Optional', `- [Sitemap](${u('/sitemap.xml')})`, `- [For vendors](${u('/for-vendors/')})`, `- Contact: ${CONTACT_EMAIL}`, '',
  ];
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
