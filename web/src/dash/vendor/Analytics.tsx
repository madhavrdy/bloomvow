// Vendor dashboard > Analytics (claimed listings only; vendor_analytics() checks this too).
import { useEffect, useState } from 'preact/hooks';
import { sb, friendly } from '../supabase';
import { fmtNum, fmtDate } from '../shared';
import { PLUM, ROSE, pct, Change, Bar, Trend, Legend } from '../charts';
import type { Listing } from './VendorApp';

type N = number;
type Report = {
  days: N; since: string; tracked_since: string | null;
  kpi: { impressions: N; impressions_prev: N; views: N; views_prev: N; visitors: N; clicks: N; clicks_prev: N;
    clicks_phone: N; clicks_website: N; clicks_directions: N; shortlists: N; leads: N; leads_prev: N };
  series: { day: string; impressions: N; views: N; leads: N }[];
  found_by: { how: string; views: N }[];
  shown_on: { path: string; times: N }[];
  devices: { device: string; views: N }[];
  lead_status: Record<string, N>;
  peers: { count: N; avg_views: N | null; avg_leads: N | null; rank: N | null; rank_of: N };
};
const STATUS: [string, string][] = [['new', 'New'], ['replied', 'Replied'], ['tour', 'Tour booked'], ['booked', 'Booked'], ['lost', 'Not a fit']];

// "/us/texas/austin/wedding-venues/barn/" -> "Austin · wedding venues · barn"
const words = (x: string) => x.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
const pageName = (p: string) => {
  const s = p.split('/').filter(Boolean);
  if (s[0] === 'blog') return `Blog: ${words(s[1] ?? '')}`;
  if (s[0] === 'vendor') return 'Your profile and other vendor pages';
  if (s.length >= 4) return [s[2], s[3], s[4]].filter(Boolean).map(words).join(' · ');
  return p;
};

export function Analytics({ listing }: { listing: Listing }) {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (listing.status !== 'claimed') return;
    setR(null); setErr('');
    sb().rpc('vendor_analytics', { p_vendor: listing.id, p_days: days }).then(({ data, error }) => (error ? setErr(friendly(error)) : setR(data as Report)));
  }, [listing.id, days]);

  if (listing.status !== 'claimed') {
    return <section class="panel"><h1 style="margin:0">Analytics</h1>
      <p style="margin:0">Analytics open once your claim for <b>{listing.name}</b> is approved. We usually check claims within one business day.</p></section>;
  }
  const k = r?.kpi;
  const maxFound = Math.max(1, ...(r?.found_by ?? []).map((f) => f.views));
  const maxShown = Math.max(1, ...(r?.shown_on ?? []).map((f) => f.times));
  const devTotal = (r?.devices ?? []).reduce((a, d) => a + d.views, 0);
  const leadTotal = Object.values(r?.lead_status ?? {}).reduce((a, n) => a + n, 0);
  const sel = 'font:inherit;border:1px solid var(--ln);border-radius:10px;padding:0 12px;min-height:44px;background:#fff';

  return (
    <>
      <div class="dhead"><h1>Analytics</h1>
        <label style="display:flex;gap:8px;align-items:center;font-size:14px">Range
          <select value={days} onChange={(e) => setDays(Number(e.currentTarget.value))} style={sel}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select></label>
      </div>
      {err && <p class="form-error">{err}</p>}
      {!r && !err && <p class="muted">Loading…</p>}
      {r && k && <>
        <div class="kpis" aria-label="Key numbers">
          <div class="kpi"><span>Shown in search results</span><b>{fmtNum(k.impressions)}</b><Change now={k.impressions} before={k.impressions_prev} /></div>
          <div class="kpi"><span>Profile views</span><b>{fmtNum(k.views)}</b><Change now={k.views} before={k.views_prev} /></div>
          <div class="kpi"><span>People who viewed</span><b>{k.visitors || !k.views ? fmtNum(k.visitors) : '–'}</b>
            <small>{k.visitors || !k.views ? 'different couples (approx.)' : `counted from ${fmtDate(r.tracked_since ?? r.since)}`}</small></div>
          <div class="kpi"><span>Calls, website & map clicks</span><b>{fmtNum(k.clicks)}</b><Change now={k.clicks} before={k.clicks_prev} /></div>
          <div class="kpi"><span>Requests received</span><b>{fmtNum(k.leads)}</b><Change now={k.leads} before={k.leads_prev} /></div>
          <div class="kpi"><span>View → request rate</span><b>{pct(k.leads, k.views)}</b><small>requests per profile view</small></div>
        </div>

        <section class="panel">
          <div class="dhead"><h2>Your listing per day</h2><Legend names={['Profile views', 'Shown in results', 'Requests']} /></div>
          <Trend s={r.series.map((d) => ({ day: d.day, line1: d.views, line2: d.impressions, bars: d.leads }))} names={['Profile views', 'Shown in results', 'Requests']} />
        </section>

        <div class="row">
          <section class="panel grow">
            <h2>How couples found your profile</h2>
            {r.found_by.length === 0 ? <p class="muted" style="margin:0">No profile views with a known source yet{r.tracked_since ? ` (tracked since ${fmtDate(r.tracked_since)})` : ''}.</p>
              : r.found_by.map((f) => <div><div style="display:flex;justify-content:space-between;font-size:14px"><b>{f.how}</b><span>{fmtNum(f.views)}</span></div>
                <Bar value={f.views} max={maxFound} /></div>)}
            <h2 style="margin-top:6px">What couples did</h2>
            {[['Called you', k.clicks_phone], ['Visited your website', k.clicks_website], ['Asked for directions', k.clicks_directions], ['Saved you to their shortlist', k.shortlists]].map(([l, n]) => (
              <div style="display:flex;justify-content:space-between;font-size:14px;border-bottom:1px solid var(--ln);padding:6px 0"><span>{l}</span><b>{fmtNum(n as N)}</b></div>))}
          </section>
          <section class="panel side-col">
            <h2>Compared with similar vendors</h2>
            <p style="margin:0;font-size:14px">{r.peers.rank ? <>You're <b>#{r.peers.rank}</b> of {r.peers.rank_of} in your category and city listing.</> : 'Not ranked yet.'}</p>
            {[['Profile views', k.views, r.peers.avg_views], ['Requests received', k.leads, r.peers.avg_leads]].map(([l, you, avg]) => {
              const m = Math.max(1, Number(you), Number(avg ?? 0));
              return <div><b style="font-size:14px">{l}</b>
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:4px"><span>You</span><span>{fmtNum(you as N)}</span></div><Bar value={you as N} max={m} color={ROSE} />
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px"><span class="muted">Average of {r.peers.count} similar vendors</span><span>{avg ?? 0}</span></div><Bar value={Number(avg ?? 0)} max={m} color={PLUM} /></div>;
            })}
            <p class="muted" style="margin:0;font-size:12px">Complete listings with photos and prices, and fast replies, rank higher.</p>
          </section>
        </div>

        <div class="row">
          <section class="panel grow">
            <h2>Where your listing was shown</h2>
            {r.shown_on.length === 0 ? <p class="muted" style="margin:0">Not shown in any listing yet this period.</p>
              : r.shown_on.map((s) => <div><div style="display:flex;justify-content:space-between;font-size:14px;gap:10px">
                <a href={s.path} target="_blank" rel="noopener">{pageName(s.path)}</a><span>{fmtNum(s.times)}</span></div>
                <Bar value={s.times} max={maxShown} color={PLUM} /></div>)}
          </section>
          <section class="panel side-col">
            <h2>Requests by stage</h2>
            {leadTotal === 0 ? <p class="muted" style="margin:0">No requests this period.</p> : STATUS.filter(([s]) => r.lead_status[s]).map(([s, l]) => (
              <div style="display:flex;justify-content:space-between;font-size:14px"><span>{l}</span><b>{r.lead_status[s]}</b></div>))}
            {leadTotal > 0 && <a href="#leads" class="btn btn-outline btn-sm" style="align-self:flex-start">Open requests</a>}
            <h2 style="margin-top:6px">Devices</h2>
            {devTotal === 0 ? <p class="muted" style="margin:0">No data yet.</p> : r.devices.map((d) => <div>
              <div style="display:flex;justify-content:space-between;font-size:14px"><b style="text-transform:capitalize">{d.device}</b><span>{pct(d.views, devTotal)}</span></div>
              <Bar value={d.views} max={devTotal} color={PLUM} /></div>)}
          </section>
        </div>
        <p class="muted" style="font-size:12px;margin:0">Counted by Celebrateio without cookies; "people who viewed" is an estimate. You see totals only, never who a visitor was.</p>
      </>}
    </>
  );
}
