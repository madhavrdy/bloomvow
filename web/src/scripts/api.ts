// Tiny client for the public Supabase RPC functions (no SDK needed on public pages).
const meta = () => document.querySelector<HTMLMetaElement>('meta[name="bv-api"]');

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const m = meta();
  const base = m?.content ?? '';
  const key = m?.dataset.key ?? '';
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
    keepalive: true,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(body?.message ?? 'error', body?.message ?? `Request failed (${res.status})`);
  return body as T;
}

// Read a public view, e.g. select('public_comments', 'post_id=eq.…').
export async function select<T = unknown>(view: string, query: string): Promise<T[]> {
  const m = meta();
  const key = m?.dataset.key ?? '';
  const res = await fetch(`${m?.content ?? ''}/rest/v1/${view}?${query}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!res.ok) throw new ApiError('error', `Request failed (${res.status})`);
  return res.json();
}

// Fire-and-forget analytics: never let tracking break the page.
export function track(vendorId: string | null, kind: string) {
  rpc('track_event', { p_vendor: vendorId, p_kind: kind, p_path: location.pathname }).catch(() => {});
  if (kind.startsWith('click_')) conversion('contact', { method: kind.slice(6) });
}

// A Google Analytics event (and the same event for Tag Manager), when those tags are present.
export function analytics(name: string, params: Record<string, string | number> = {}) {
  try {
    const w = window as W;
    w.gtag?.('event', name, params);
    w.dataLayer?.push({ event: name, ...params });
  } catch { /* never break the page */ }
}

// Conversion events for the ad and analytics tags set in Admin > Tracking (when present).
type W = Window & { gtag?: (...a: unknown[]) => void; fbq?: (...a: unknown[]) => void; dataLayer?: unknown[] };
export function conversion(name: 'lead' | 'contact', params: Record<string, string | number> = {}) {
  try {
    const w = window as W;
    if (name === 'lead') {
      w.gtag?.('event', 'generate_lead', params);
      const sendTo = document.querySelector<HTMLMetaElement>('meta[name="bv-track"]')?.dataset.adsLead;
      if (sendTo) w.gtag?.('event', 'conversion', { send_to: sendTo });
      w.fbq?.('track', 'Lead', params);
    } else {
      w.gtag?.('event', 'contact', params);
      w.fbq?.('track', 'Contact', params);
    }
    w.dataLayer?.push({ event: name === 'lead' ? 'generate_lead' : 'contact', ...params });
  } catch { /* never break the page */ }
}

export const friendlyError = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : '';
  return ({
    invalid_email: 'Please enter a valid email address.',
    invalid_phone: 'Please check your phone number, like (212) 423-0172. Outside the US and Canada, start with + and the country code.',
    phone_required: 'Please enter your phone number so vendors can reach you.',
    invalid_date: 'Please choose a wedding date between today and 5 years from now.',
    name_required: 'Please enter your name.',
    invalid_guests: 'Please enter a guest count between 1 and 3,000.',
    invalid_city: 'Please choose your wedding city.',
    invalid_categories: 'Please choose at least one type of vendor.',
    category_unavailable: "One of the services you picked isn't available in that country yet. Please remove it and try again.",
    rate_limited: "You've sent several requests in the last hour. Please try again a little later.",
  } as Record<string, string>)[code] ?? 'Something went wrong sending your request. Please try again.';
};
