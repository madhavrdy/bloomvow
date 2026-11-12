// FAQ markup for blog posts: a "Frequently asked questions" (or "FAQ") section with each
// question as a sub-heading becomes FAQPage structured data, which search engines and AI
// answers use for "People also ask"-style results.
import type { Faq } from './seo';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

export function postFaqs(html: string): Faq[] {
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)];
  const i = h2s.findIndex((m) => /\b(faqs?|frequently asked)\b/i.test(text(m[1])));
  if (i < 0) return [];
  const start = h2s[i].index! + h2s[i][0].length;
  const end = h2s[i + 1]?.index ?? html.length;
  const out: Faq[] = [];
  for (const part of html.slice(start, end).split(/(?=<h3[\s>])/).filter((s) => s.startsWith('<h3'))) {
    const m = part.match(/^<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*)$/);
    if (!m) continue;
    const q = text(m[1]).replace(/^(q?\d+[.):]\s*)/i, '');
    const a = text(m[2]);
    if (q.length >= 8 && a.length >= 20) out.push({ q: q.slice(0, 300), a: a.slice(0, 2000) });
  }
  return out.slice(0, 20);
}
