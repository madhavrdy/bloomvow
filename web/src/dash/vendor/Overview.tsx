import { useEffect, useState } from 'preact/hooks';
import { sb, must } from '../supabase';
import { fmtNum, fmtDate, replyTime, type Category, type City } from '../shared';
import { listingChecks, strength } from './completeness';
import type { Listing } from './VendorApp';

type Stats = {
  impressions: number; views: number; clicks: number; clicks_phone: number; clicks_website: number; clicks_directions: number;
  shortlists: number; leads: number; leads_new: number; avg_reply_minutes: number | null; rating: number | null; review_count: number;
  rank: number | null; rank_of: number;
};
type LeadRow = { lead_id: string; status: string; sent_at: string; leads: { couple_name: string; wedding_date: string | null; guests: number | null } };

export function Overview({ listing, category, city, userName }: { listing: Listing; category: Category; city: City; userName: string }) {
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<LeadRow[]>([]);
  const [checks, setChecks] = useState<ReturnType<typeof listingChecks> | null>(null);

  useEffect(() => {
    sb().rpc('vendor_stats', { p_vendor: listing.id, p_days: days }).then(({ data }) => setS(data as Stats));
  }, [listing.id, days]);
  useEffect(() => {
    must<LeadRow[]>(sb().from('lead_recipients').select('lead_id,status,sent_at,leads(couple_name,wedding_date,guests)')
      .eq('vendor_id', listing.id).order('sent_at', { ascending: false }).limit(3) as never).then(setRecent);
    Promise.all([
      sb().from('photos').select('id', { count: 'exact', head: true }).eq('vendor_id', listing.id),
      must<{ price: number | null }[]>(sb().from('packages').select('price').eq('vendor_id', listing.id) as never),
    ]).then(([ph, pk]) => setChecks(listingChecks({ ...listing, usesCapacity: category.uses_capacity, photos: ph.count ?? 0, packages: pk })));
  }, [listing]);

  const pct = checks ? strength(checks) : 100;
  const todo = checks?.filter((c) => !c.done) ?? [];
  const funnel = s ? [
    ['Shown in search results', s.impressions], ['Profile views', s.views], ['Clicks (phone, website, directions)', s.clicks],
    ['Saved to shortlists', s.shortlists], ['Leads received', s.leads],
  ] as [string, number][] : [];
  const max = Math.max(1, ...funnel.map((f) => f[1]));

  return (
    <>
      <div class="dhead">
        <h1>{userName ? `Welcome back, ${userName.split(' ')[0]}` : listing.name}</h1>
        <label style="display:flex;gap:8px;align-items:center;font-size:14px">Range
          <select value={days} onChange={(e) => setDays(Number(e.currentTarget.value))} style="font:inherit;border:1px solid var(--ln);border-radius:10px;padding:0 12px;min-height:44px;background:#fff">
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        </label>
      </div>

      {pct < 100 && (
        <div class="banner">
          <div style="flex:1 1 360px;display:flex;flex-direction:column;gap:10px">
            <b style="font-size:17px">Your listing is {pct}% complete</b>
            <div class="bar"><div style={`width:${pct}%`} /></div>
            <span style="font-size:14px;color:#cfe3db">Still to do: {todo.map((t) => t.label.toLowerCase()).join(', ')}. Complete listings rank higher and get more requests.</span>
          </div>
          <a href="#listing" class="btn btn-lg" style="background:#fff;color:var(--acc-ink)">Finish listing</a>
        </div>
      )}
      {listing.status === 'hidden' && <p class="form-error">This listing is hidden from the public site. Contact us if you think this is a mistake.</p>}

      <div class="kpis" aria-label="Key numbers">
        <div class="kpi"><span>Profile views</span><b>{fmtNum(s?.views)}</b><small>last {days} days</small></div>
        <div class="kpi"><span>Clicks</span><b>{fmtNum(s?.clicks)}</b><small>{s ? `${s.clicks_phone} phone · ${s.clicks_website} website · ${s.clicks_directions} directions` : ''}</small></div>
        <div class="kpi"><span>Leads</span><b>{fmtNum(s?.leads)}</b><small>{s?.leads_new ? `${s.leads_new} waiting for a reply` : 'all answered'}</small></div>
        <div class="kpi"><span>Avg. reply time</span><b>{replyTime(s?.avg_reply_minutes)}</b><small>faster replies win more bookings</small></div>
        <div class="kpi"><span>Rating</span><b>{s?.rating ? `${Number(s.rating).toFixed(1)} ★` : '–'}</b><small>{s?.review_count ?? 0} reviews</small></div>
      </div>

      <div class="row">
        <section class="panel grow">
          <h2>Where couples interact with you</h2>
          {funnel.map(([label, n]) => (
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between;font-size:14px"><span style="font-weight:600">{label}</span><b>{fmtNum(n)}</b></div>
              <div class="bar"><div style={`width:${Math.max(2, Math.round(Math.sqrt(n / max) * 100))}%`} /></div>
            </div>
          ))}
        </section>
        <div class="side-col" style="display:flex;flex-direction:column;gap:16px">
          <section class="panel">
            <span class="muted" style="font-size:13px;font-weight:600">Your position</span>
            <b style="font-size:26px">{s?.rank ? `#${s.rank}` : '–'}</b>
            <span style="font-size:14px">in {city.label.split(',')[0]} {category.name.toLowerCase()} ({s?.rank_of ?? '–'} listed)</span>
            <span class="muted" style="font-size:13px">Ranking: Featured plan first, then verified owners, then rating and number of reviews.</span>
          </section>
          <section class="panel" style="background:var(--rose-soft);border-color:transparent">
            {listing.plan === 'featured' ? (
              <><b>Featured plan is active</b><span style="font-size:14px">Top placement on your city pages, up to 5 cities, matched first in requests.{listing.plan_renews_at && ` Renews ${fmtDate(listing.plan_renews_at)}.`}</span></>
            ) : (
              <><b>Get more leads with Featured</b><span style="font-size:14px">Top placement on your city pages, appear in up to 5 cities, and get matched first when couples request quotes.</span>
                <a href={`mailto:${document.querySelector<HTMLMetaElement>('meta[name="bv-api"]')?.dataset.contact ?? ''}?subject=Featured%20plan`} style="font-weight:600;color:var(--rose-dark)">Ask about Featured →</a></>
            )}
          </section>
        </div>
      </div>

      <section class="panel">
        <div class="dhead"><h2>Latest leads</h2><a href="#leads" style="font-weight:600;color:var(--acc)">Open inbox →</a></div>
        {recent.length === 0 ? <p class="empty">No leads yet. Complete your listing to start appearing in more requests.</p> : recent.map((r) => (
          <a href="#leads" class="result" style="text-decoration:none">
            <div style="display:flex;flex-direction:column"><b>{r.leads.couple_name}</b>
              <span class="muted" style="font-size:13px">{r.leads.wedding_date ? fmtDate(r.leads.wedding_date) : 'Date flexible'}{r.leads.guests ? ` · ${r.leads.guests} guests` : ''}</span></div>
            <span class={`chip-s s-${r.status}`}>{statusLabel(r.status)}</span>
          </a>
        ))}
      </section>
    </>
  );
}

export const statusLabel = (s: string) => ({ new: 'New', replied: 'Replied', tour: 'Tour booked', booked: 'Booked', lost: 'Not a fit' } as Record<string, string>)[s] ?? s;
