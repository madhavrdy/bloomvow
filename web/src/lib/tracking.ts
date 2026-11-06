// Tracking & analytics IDs set in Admin > Tracking. Same formats as tracking_ok() in the
// database; anything that doesn't match is dropped, so only clean IDs reach the page.
export type Tracking = { ga4?: string; gtm?: string; google_ads?: string; google_ads_lead_label?: string; meta_pixel?: string; gsc?: string; bing?: string };
export const TRACKING_FORMATS: Record<keyof Tracking, RegExp> = {
  ga4: /^G-[A-Z0-9]{4,16}$/,
  gtm: /^GTM-[A-Z0-9]{4,12}$/,
  google_ads: /^AW-[0-9]{1,15}$/,
  google_ads_lead_label: /^[A-Za-z0-9_-]{4,64}$/,
  meta_pixel: /^[0-9]{1,20}$/,
  gsc: /^[A-Za-z0-9_-]{8,100}$/,
  bing: /^[A-Fa-f0-9]{8,64}$/,
};

export function cleanTracking(v: unknown): Tracking {
  const out: Tracking = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, re] of Object.entries(TRACKING_FORMATS) as [keyof Tracking, RegExp][]) {
    const s = (v as Record<string, unknown>)[k];
    if (typeof s === 'string' && re.test(s.trim())) out[k] = s.trim();
  }
  return out;
}

// Accepts what people usually paste (a whole snippet or meta tag) and pulls out the ID.
export function extractId(k: keyof Tracking, raw: string): string {
  const s = raw.trim();
  const pick = (re: RegExp) => s.match(re)?.[1] ?? s;
  switch (k) {
    case 'ga4': return pick(/\b(G-[A-Z0-9]{4,16})\b/i).toUpperCase();
    case 'gtm': return pick(/\b(GTM-[A-Z0-9]{4,12})\b/i).toUpperCase();
    case 'google_ads': return pick(/\b(AW-\d{1,15})\b/i).toUpperCase();
    case 'google_ads_lead_label': return pick(/AW-\d+\/([A-Za-z0-9_-]{4,64})/);
    case 'meta_pixel': return pick(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{1,20})['"]/).replace(/\s/g, '');
    case 'gsc': return pick(/google-site-verification["']?\s+content=["']([^"']+)["']/i).replace(/^google-site-verification=/, '');
    case 'bing': return pick(/msvalidate\.01["']?\s+content=["']([^"']+)["']/i);
  }
}
