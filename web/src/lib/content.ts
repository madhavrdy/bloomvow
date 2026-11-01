// Editor-written page content (Admin > Page content), with fallbacks to the
// automatic text. Keyed by URL path.
import type { SiteData } from './data';
import { renderMarkdown, type Heading } from './markdown';
import type { Faq } from './seo';

export type Content = {
  intro: string | null; body: { html: string; headings: Heading[] } | null; faqs: Faq[];
  seoTitle: string | null; seoDescription: string | null; hero: { url: string; alt: string } | null; updatedAt: string | null;
};
export const INTRO_TARGET = 350;

export function contentFor(d: SiteData, path: string, siteHost = ''): Content {
  const c = d.contentByPath.get(path);
  const t = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  return {
    intro: t(c?.intro),
    body: t(c?.body) ? renderMarkdown(c!.body!, siteHost) : null,
    faqs: (c?.faqs ?? []).filter((f) => f.q?.trim() && f.a?.trim()),
    seoTitle: t(c?.seo_title), seoDescription: t(c?.seo_description),
    hero: t(c?.hero_url) ? { url: c!.hero_url!, alt: c!.hero_alt ?? '' } : null,
    updatedAt: c?.updated_at ?? null,
  };
}

// Custom FAQs first, then automatic ones whose question isn't already covered.
export function mergeFaqs(custom: Faq[], auto: Faq[]): Faq[] {
  const seen = new Set(custom.map((f) => f.q.trim().toLowerCase()));
  return [...custom, ...auto.filter((f) => !seen.has(f.q.trim().toLowerCase()))];
}
export const latest = (...dates: (string | null | undefined)[]) => dates.filter(Boolean).sort().at(-1) ?? null;
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
