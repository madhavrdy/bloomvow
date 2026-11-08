// Fills the shared /blog-post/?p=<slug> page for a post published since the last site build.
// As soon as the rebuilt page exists, readers are sent to /blog/<slug>/ instead.
import { renderMarkdown, readingMinutes, plainText } from '../lib/markdown';

const meta = () => document.querySelector<HTMLMetaElement>('meta[name="bv-api"]')!;
async function get<T>(path: string): Promise<T[]> {
  const m = meta();
  const res = await fetch(`${m.content}/rest/v1/${path}`, { headers: { apikey: m.dataset.key!, authorization: `Bearer ${m.dataset.key}` } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
const $ = (id: string) => document.getElementById(id)!;
const fmt = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

type Post = { slug: string; title: string; body: string; excerpt: string | null; cover_url: string | null; cover_alt: string | null;
  author_name: string | null; category_id: number; published_at: string; seo_title: string | null; seo_description: string | null };

export async function initBlogFallback() {
  const slug = (new URLSearchParams(location.search).get('p') ?? '').toLowerCase();
  try {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error('missing');
    const real = `/blog/${slug}/`;
    const head = await fetch(real, { method: 'HEAD' }).catch(() => null);
    if (head?.ok) { location.replace(real + location.hash); return; }

    const [p] = await get<Post>(`public_posts?slug=eq.${slug}&select=slug,title,body,excerpt,cover_url,cover_alt,author_name,category_id,published_at,seo_title,seo_description`);
    if (!p) throw new Error('missing');
    const [cat] = await get<{ slug: string; name: string }>(`public_blog_categories?id=eq.${p.category_id}&select=slug,name`);

    document.title = `${p.seo_title || p.title} | ${document.title.split('|').pop()!.trim()}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', p.seo_description || p.excerpt || plainText(p.body, 155));
    history.replaceState(null, '', real + location.hash);                // keep the real address in the bar
    const catUrl = cat ? `/blog/category/${cat.slug}/` : '/blog/';
    for (const id of ['bp-cat', 'bp-cat-crumb']) { const a = $(id) as HTMLAnchorElement; a.href = catUrl; a.textContent = cat?.name ?? 'Blog'; }
    $('bp-crumb').textContent = p.title;
    $('bp-title').textContent = p.title;
    $('bp-meta').textContent = [p.author_name && `By ${p.author_name}`, fmt(p.published_at), `${readingMinutes(p.body)} min read`].filter(Boolean).join(' · ');
    if (p.cover_url && /^https:\/\//.test(p.cover_url)) {
      const img = $('bp-cover') as HTMLImageElement; img.src = p.cover_url; img.alt = p.cover_alt ?? ''; img.hidden = false;
    }
    const { html, headings } = renderMarkdown(p.body, location.host);  // Markdown is rendered safely (raw HTML escaped)
    $('bp-body').innerHTML = html;
    if (headings.length >= 3) {
      const toc = $('bp-toc');
      const ol = toc.querySelector('ol')!;
      for (const h of headings) {
        const li = document.createElement('li'); li.className = `d${h.depth}`;
        const a = document.createElement('a'); a.href = `#${h.id}`; a.textContent = new DOMParser().parseFromString(h.text, 'text/html').body.textContent ?? '';
        li.append(a); ol.append(li);
      }
      toc.hidden = false;
    }
    $('bp-loading').hidden = true; $('bp-page').hidden = false;
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  } catch {
    $('bp-loading').hidden = true; $('bp-missing').hidden = false;
  }
}
