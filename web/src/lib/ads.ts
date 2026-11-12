// Ad placements and AdSense settings (Admin > Ads). Same rules as ads_ok() in the database
// (migration 026): only a publisher ID, numeric ad-unit IDs and well-formed ads.txt lines.
export type Placement = 'city_top' | 'city_list' | 'vendor_page' | 'blog_list' | 'post_intro' | 'post_mid' | 'post_end' | 'post_side';
export const PLACEMENTS: { key: Placement; label: string; where: string; sponsors: boolean }[] = [
  { key: 'city_top', label: 'City pages: top', where: 'City overview and city + category pages, above the vendor list', sponsors: true },
  { key: 'city_list', label: 'City pages: in the list', where: 'After the 6th vendor in the list, and after "Top-rated" on the city overview', sponsors: true },
  { key: 'vendor_page', label: 'Vendor pages', where: 'Below the FAQs on free and unclaimed vendor pages (never on featured vendors)', sponsors: true },
  { key: 'blog_list', label: 'Blog list', where: 'After the 6th post card on the blog, category and author pages', sponsors: false },
  { key: 'post_intro', label: 'Blog post: after intro', where: 'After the intro (or the first section, if the post opens with a heading)', sponsors: false },
  { key: 'post_mid', label: 'Blog post: mid-article', where: 'Before the section heading nearest the middle (posts with 4+ sections)', sponsors: false },
  { key: 'post_end', label: 'Blog post: end', where: 'After the article, before comments and related posts', sponsors: false },
  { key: 'post_side', label: 'Blog post: side column', where: 'Under the table of contents, desktop only', sponsors: false },
];
export type AdsConfig = { client?: string; slots?: Partial<Record<Placement, string>>; off?: Placement[]; ads_txt?: string };

export const CLIENT_RE = /^ca-pub-[0-9]{10,20}$/;
export const SLOT_RE = /^[0-9]{6,20}$/;
export const ADS_TXT_LINE = /^[a-z0-9.-]+\.[a-z]{2,}\s*,\s*[A-Za-z0-9_-]{1,64}\s*,\s*(DIRECT|RESELLER)(\s*,\s*[A-Za-z0-9]{1,64})?$/i;

export function cleanAds(v: unknown): AdsConfig {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: AdsConfig = {};
  if (typeof o.client === 'string' && CLIENT_RE.test(o.client)) out.client = o.client;
  if (typeof o.ads_txt === 'string') out.ads_txt = o.ads_txt;
  return out;
}

/** ads.txt: Google's line for the publisher ID plus any extra lines from Admin > Ads. */
export function adsTxt(c: AdsConfig): string {
  const lines: string[] = [];
  if (c.client) lines.push(`google.com, ${c.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`);
  for (const raw of (c.ads_txt ?? '').split('\n')) {
    const l = raw.trim();
    if (l && (l.startsWith('#') || ADS_TXT_LINE.test(l)) && !lines.includes(l)) lines.push(l);
  }
  return lines.length ? lines.join('\n') + '\n' : '# No advertising partners yet\n';
}

/** Accepts a pasted AdSense snippet or just the ID and pulls out what we need. */
export function pickClient(raw: string): string {
  return raw.match(/ca-pub-[0-9]{10,20}/)?.[0] ?? raw.match(/pub-([0-9]{10,20})/)?.[1]?.replace(/^/, 'ca-pub-') ?? raw.trim();
}
export function pickSlot(raw: string): string {
  return raw.match(/data-ad-slot=["']?([0-9]{6,20})/)?.[1] ?? raw.trim();
}
