// Fills the page's ad slots (components/AdSlot.astro) with one call to ads_for(): a sponsor
// banner where one is booked for this city/category, otherwise the AdSense unit for that
// placement, otherwise the slot stays hidden. Counts sponsor views (once seen) and clicks.
type Sponsor = { id: string; image: string; link: string; alt: string };
type Answer = { client: string | null; slots: Record<string, string>; sponsors: Record<string, Sponsor> };

const meta = () => document.querySelector<HTMLMetaElement>('meta[name="bv-api"]');
async function rpc<T>(fn: string, body: unknown, keepalive = false): Promise<T | null> {
  const m = meta(); if (!m) return null;
  const res = await fetch(`${m.content}/rest/v1/rpc/${fn}`, { method: 'POST', keepalive,
    headers: { apikey: m.dataset.key!, authorization: `Bearer ${m.dataset.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.ok ? (res.status === 204 ? null : res.json()) : null;
}
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let started = false;
let adsenseLoaded = false;
function loadAdSense(client: string) {
  if (adsenseLoaded) return;
  adsenseLoaded = true;
  const s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.append(s);
}

export function initAds() {
  if (started) return;
  started = true;
  const run = async () => {
    const slots = [...document.querySelectorAll<HTMLElement>('.ad-slot[data-ad]')];
    if (!slots.length) return;
    const first = slots[0].dataset;
    const ans = await rpc<Answer>('ads_for', {
      p_placements: [...new Set(slots.map((s) => s.dataset.ad))],
      p_city: first.city ? Number(first.city) : null, p_category: first.cat ? Number(first.cat) : null, p_vendor: first.vendor || null,
    }).catch(() => null);
    if (!ans) return;
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) {
        seen.unobserve(e.target);
        rpc('track_ad', { p_ad: (e.target as HTMLElement).dataset.sponsor, p_kind: 'view' }).catch(() => {});
      }
    }, { threshold: 0.5 });
    for (const slot of slots) {
      const key = slot.dataset.ad!;
      const sp = ans.sponsors[key];
      if (sp && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(sp.image) && /^https?:\/\//.test(sp.link)) {
        slot.innerHTML = `<span class="ad-label">Sponsored</span><a class="ad-sponsor" href="${esc(sp.link)}" target="_blank" rel="sponsored noopener"><img src="${esc(sp.image)}" alt="${esc(sp.alt)}" loading="lazy" decoding="async"></a>`;
        slot.dataset.sponsor = sp.id;
        slot.querySelector('a')!.addEventListener('click', () => { rpc('track_ad', { p_ad: sp.id, p_kind: 'click' }, true).catch(() => {}); });
        slot.hidden = false;
        seen.observe(slot);
      } else if (ans.client && ans.slots[key]) {
        slot.innerHTML = `<span class="ad-label">Advertisement</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(ans.client)}" data-ad-slot="${esc(ans.slots[key])}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
        slot.hidden = false;
        loadAdSense(ans.client);
        try { ((window as unknown as { adsbygoogle: unknown[] }).adsbygoogle ||= []).push({}); } catch { /* blocked */ }
      }
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
}
