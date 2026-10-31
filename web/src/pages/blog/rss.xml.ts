import type { APIContext } from 'astro';
import { getData } from '../../lib/data';
import { plainText } from '../../lib/markdown';
import { SITE_NAME } from '../../config';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function GET({ site }: APIContext) {
  const d = await getData();
  const items = d.posts.slice(0, 30).map((p) => {
    const link = new URL(d.urls.post(p), site).href;
    return `<item><title>${esc(p.title)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate><category>${esc(d.blogCategoryById.get(p.category_id)!.name)}</category><description>${esc(p.excerpt || plainText(p.body, 300))}</description></item>`;
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(SITE_NAME)} blog</title><link>${new URL('/blog/', site).href}</link><description>Wedding planning advice from ${esc(SITE_NAME)}</description><language>en-us</language>\n${items.join('\n')}\n</channel></rss>\n`;
  return new Response(body, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}
