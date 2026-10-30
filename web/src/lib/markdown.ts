// Markdown -> safe HTML for blog posts and page content.
// Raw HTML in the source is escaped (never rendered), headings get anchor ids,
// and external links open in a new tab with rel="nofollow noopener".
import { Marked, type Tokens } from 'marked';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slugifyHeading = (s: string) =>
  s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export type Heading = { depth: number; text: string; id: string };

export function renderMarkdown(src: string, siteHost = ''): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const m = new Marked({ gfm: true, breaks: false });
  m.use({
    renderer: {
      html(t: Tokens.HTML | Tokens.Tag) { return esc(t.text); },
      heading(t: Tokens.Heading) {
        const text = this.parser.parseInline(t.tokens);
        let id = slugifyHeading(text) || 'section';
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n + 1}`;
        if (t.depth === 2 || t.depth === 3) headings.push({ depth: t.depth, text: text.replace(/<[^>]+>/g, ''), id });
        return `<h${t.depth} id="${id}">${text}</h${t.depth}>\n`;
      },
      link(t: Tokens.Link) {
        const href = t.href ?? '';
        if (/^\s*(javascript|data|vbscript):/i.test(href)) return this.parser.parseInline(t.tokens);
        const external = /^https?:\/\//i.test(href) && !(siteHost && href.includes(siteHost));
        const title = t.title ? ` title="${esc(t.title)}"` : '';
        return `<a href="${esc(href)}"${title}${external ? ' target="_blank" rel="nofollow noopener"' : ''}>${this.parser.parseInline(t.tokens)}</a>`;
      },
      image(t: Tokens.Image) {
        if (!/^(https?:\/\/|\/)/i.test(t.href ?? '')) return esc(t.text);
        return `<img src="${esc(t.href)}" alt="${esc(t.text)}" loading="lazy" decoding="async" />`;
      },
    },
  });
  const html = m.parse(src ?? '', { async: false }) as string;
  return { html, headings };
}

// Plain-text excerpt for previews and meta descriptions.
export function plainText(src: string, max = 160): string {
  const t = (src ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
}

export const readingMinutes = (src: string) => Math.max(1, Math.round((src ?? '').split(/\s+/).filter(Boolean).length / 225));
