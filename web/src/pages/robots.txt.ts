import type { APIContext } from 'astro';

// Search engines and AI assistants are welcome to read and cite public pages.
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot',
  'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot'];
const PRIVATE = ['/admin/', '/vendor-dashboard/', '/shortlist/'];

export function GET({ site }: APIContext) {
  const block = (ua: string) => `User-agent: ${ua}\nAllow: /\n${PRIVATE.map((p) => `Disallow: ${p}`).join('\n')}\n`;
  const body = [block('*'), ...AI_BOTS.map(block), `Sitemap: ${new URL('/sitemap.xml', site).href}\n`].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain' } });
}
